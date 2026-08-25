# How AdonisJS resolves the request hostname (and what that means behind Cloudflare)

Research ticket for adonis-req-logger. Source inspected: `@adonisjs/http-server@9.3.0` (the version resolved by `@adonisjs/core@7.5.x`, which this repo targets via peer `@adonisjs/core ^7.0.0`) and `@adonisjs/http-server@9.1.0`, both present in the pnpm store of this repo. The relevant code is **identical in both versions**. Official docs cross-checked at docs.adonisjs.com (the live docs serve the current major; no version switcher is present on the Request page).

All `file:line` references below point into the bundled build file:

> `node_modules/.pnpm/@adonisjs+http-server@9.3.0_.../node_modules/@adonisjs/http-server/build/define_config-BO3FUjx5.js`
> (helpers: `.../build/helpers-BJvp4oB8.js`)

The 9.1.0 equivalents live in `define_config-Cuq6_o-f.js` at nearly identical line numbers (e.g. `hostname()` at 2059).

## Summary

- `request.hostname()` = `request.host()` minus the port. `host()` reads the `Host` header, and **only if** the socket's remote address passes the `trustProxy` check does `X-Forwarded-Host` take priority over `Host` (define_config-BO3FUjx5.js:2020–2025, 2061–2067).
- With an untrusted proxy (or no `X-Forwarded-Host` header), you get the raw `Host` header; with no `Host` header at all, `host()`/`hostname()` return `null`.
- `hostname()` strips the port correctly, including bracketed IPv6 literals (`[::1]:3333` → `[::1]`); `host()` keeps the port.
- Default `trustProxy` in a fresh Adonis v6/v7 app is `proxyaddr.compile('loopback')` (define_config-BO3FUjx5.js:5520) — only 127.0.0.1/8 and ::1 are trusted. The backend app in this repo (`apps/backend/config/app.ts`) does not set `trustProxy`, so it uses that default.
- The same `trustProxy` setting drives `request.ip()`/`ips()` (proxy-addr walking `X-Forwarded-For`) and `request.protocol()` (`X-Forwarded-Proto`), so hostname, client IP, and scheme are all correct-or-wrong together.
- **Cloudflare preserves the original `Host` header to the origin by default** and does **not** set `X-Forwarded-Host`. So behind Cloudflare, `hostname()` returns the public domain even with the default (untrusted) `trustProxy` — no config needed *for the hostname*.
- `request.ip()` behind Cloudflare with default `trustProxy` returns a **Cloudflare edge IP**, not the visitor. Fixing it requires trusting the proxy chain (Cloudflare IP ranges, or the immediate reverse proxy) or a custom `getIp` reading `CF-Connecting-IP`.
- Edge cases for a logger: `X-Forwarded-Host` is not split on commas (multi-proxy chains can log `"a.com, b.com"`), HTTP/1.0 requests may omit `Host` entirely (→ `null`), and raw HTTP/2 `:authority` is not consulted by `hostname()` (Adonis added a separate `authority()` method for that).
- Docs gap: the official Request docs page does not document `hostname()`/`host()`/`subdomains()` at all (see Q2 below); behavior above is from source.

---

## Q1 — What `hostname()`, `host()`, `headers()` do exactly

### `headers()` / `header(key, default)` — define_config-BO3FUjx5.js:1886–1903

```js
headers() {
    return this.request.headers;
}
header(key, defaultValue) {
    key = key.toLowerCase();
    const headers = this.headers();
    switch (key) {
        case "referer":
        case "referrer": return headers.referrer || headers.referer || defaultValue;
        default: return headers[key] || defaultValue;
    }
}
```

Thin, case-insensitive wrappers over Node's `IncomingMessage.headers`. No normalization beyond the referer/referrer alias. Note `||` (not `??`): an empty-string header value falls through to the default.

### `host()` — define_config-BO3FUjx5.js:2020–2025

```js
host() {
    let host = this.header("host");
    if (trustProxy(this.request.socket.remoteAddress, this.#config.trustProxy)) host = this.header("X-Forwarded-Host") || host;
    if (!host) return null;
    return host;
}
```

Behavior matrix:

| trustProxy(remoteAddr) | `X-Forwarded-Host` present | Result |
|---|---|---|
| false | (irrelevant) | raw `Host` header, or `null` if absent |
| true | yes | raw `X-Forwarded-Host` value (whole string, port and all) |
| true | no / empty | raw `Host` header, or `null` if absent |

The trust check is on the **immediate socket peer only**: `trustProxy(remoteAddress, proxyFn)` calls `proxyFn(remoteAddress, 0)` — distance 0 — with a 200-entry LRU cache keyed by remote address (helpers-BJvp4oB8.js:1108, 1178–1183):

```js
const proxyCache = new Cache({ max: 200 });
function trustProxy(remoteAddress, proxyFn) {
    if (proxyCache.has(remoteAddress)) return proxyCache.get(remoteAddress);
    const result = proxyFn(remoteAddress, 0);
    proxyCache.set(remoteAddress, result);
    return result;
}
```

So for `host()`/`protocol()`, only the directly-connected peer's IP decides trust (unlike `ip()`, which walks the whole chain).

### `hostname()` — define_config-BO3FUjx5.js:2061–2067

```js
hostname() {
    const host = this.host();
    if (!host) return null;
    const offset = host[0] === "[" ? host.indexOf("]") + 1 : 0;
    const index = host.indexOf(":", offset);
    return index !== -1 ? host.substring(0, index) : host;
}
```

- **Port is stripped** (`example.com:8080` → `example.com`).
- IPv6 literals are handled: the search for `:` starts after the closing `]`, so `[2001:db8::1]:443` → `[2001:db8::1]` (brackets retained).
- Returns `null` when `host()` is `null` (no Host header and no trusted `X-Forwarded-Host`).

### `authority()` — define_config-BO3FUjx5.js:2040–2042 (new-ish, present in 9.1.0 and 9.3.0)

```js
authority() {
    return this.header(":authority") || this.host() || null;
}
```

Per its JSDoc (lines 2026–2039): "Unlike [[host]], this method does not consult `X-Forwarded-Host` and is not affected by the `trustProxy` config, because no proxy convention exists for forwarding the original `:authority`." This is the only place the HTTP/2 pseudo-header is read; `host()`/`hostname()` never look at `:authority`.

Related consumers: `subdomains()` (2075–2082) splits `hostname()` on `.` using `subdomainOffset` (default 2) and returns `[]` for `null`/IP hostnames; `completeUrl()` (2148) builds `protocol()://host()...` (note: uses `host()`, so it keeps the port); the request's own log serializer includes `hostname: this.hostname()` (2469); the router uses `ctx.request.hostname()` for domain matching only when routes declare domains (5078).

## Q2 — `trustProxy` configuration and `request.ip()`

### Default value

`defineConfig()` (define_config-BO3FUjx5.js:5516–5531) sets:

```js
const defaults = {
    allowMethodSpoofing: false,
    trustProxy: proxyaddr.compile("loopback"),
    subdomainOffset: 2,
    ...
    redirect: { allowedHosts: [], forwardQueryString: false },
```

and normalizes user values (5571–5578): boolean → constant function, string → `proxyaddr.compile(string)`, function → used as-is. So in a fresh Adonis v6/v7 app — including `apps/backend/config/app.ts` in this repo, which sets `generateRequestId`, `allowMethodSpoofing`, `useAsyncLocalStorage`, `redirect`, `cookie` but **not** `trustProxy` — only loopback peers (`127.0.0.1/8`, `::1/128`) are trusted. Any real reverse proxy on another host/container is untrusted by default.

`trustProxy` accepts everything [proxy-addr](https://www.npmjs.com/package/proxy-addr) accepts (`proxy-addr@2.0.7` in this repo): `true`/`false`, IP/CIDR strings or arrays, the presets `loopback` / `linklocal` / `uniquelocal`, or a `(addr, index) => boolean` function.

Note that `allowedHosts` in Adonis is **not** a hostname allow-list for `hostname()` — it exists only under `redirect.allowedHosts` (default `[]`, line 5531) and in `request.getPreviousUrl(allowedHosts, fallback)` (2161), where it validates the `Referer` host before redirecting back. Nothing filters what `hostname()` returns.

### `request.ip()` / `ips()` — define_config-BO3FUjx5.js:1937–1963

```js
ip() {
    const ipFn = this.#config.getIp;
    if (typeof ipFn === "function") return ipFn(this, () => proxyaddr(this.request, this.#config.trustProxy));
    return proxyaddr(this.request, this.#config.trustProxy);
}
ips() {
    return proxyaddr.all(this.request, this.#config.trustProxy);
}
```

proxy-addr semantics: start at `socket.remoteAddress` and walk the `X-Forwarded-For` chain **right to left**, stepping past each address that is trusted; return the first untrusted address (or the leftmost entry if everything is trusted). With the default loopback-only trust and a non-local proxy, `ip()` is simply the proxy's socket IP. The `getIp` escape hatch (config `http.getIp`) receives the request plus a fallback thunk — this is how the official docs recommend handling Cloudflare's `CF-Connecting-IP` (see Q3).

`protocol()` (1985–1992) uses the same single-hop `trustProxy` check as `host()` and, when trusted, takes the **first** element of a comma-split `X-Forwarded-Proto` — note the asymmetry: `X-Forwarded-Proto` is comma-split, `X-Forwarded-Host` is not.

### What the official docs say (docs.adonisjs.com)

Checked 2026-08-25 at https://docs.adonisjs.com/guides/basics/request (the live docs for the current major; the page carries no explicit v6/v7 marker):

- Section "Trusting proxy servers": "When your application runs behind a reverse proxy (like Nginx) or load balancer, you need to configure which proxy IP addresses to trust." … "This allows AdonisJS to correctly read the `X-Forwarded-*` headers that proxies add to requests." Example given: `trustProxy: proxyAddr.compile(['loopback', 'uniquelocal'])`, described as "safe for most deployment scenarios where your proxy runs on the same machine or private network." Alternatives shown: trust-all (flagged not recommended for production), specific IPs, CIDR ranges.
- Section "Custom IP address extraction": documents `http.getIp`, which "must return a string IP address or `undefined` to fall back to default behavior", with a worked example reading Cloudflare's `CF-Connecting-IP` and falling back to the default chain. "Useful when working with CDNs that provide the real client IP in custom headers."
- The docs list `request.ip()` ("Returns the client IP address"), `request.ips()` ("Returns array of IPs when behind proxies"), and `getPreviousUrl(allowedHosts, fallback?)` ("Returns the validated previous URL from the `Referer` header").

**Docs/source disagreements & gaps to flag:**

1. **`hostname()`, `host()`, `authority()`, and `subdomains()` are not documented at all** on the Request page (searched: no occurrence of "hostname", "host", or "subdomain" in the page body). Their behavior — including the `X-Forwarded-Host` priority rule and the port stripping — is only visible in source/JSDoc. Everything in Q1 is therefore source-derived, not doc-derived.
2. The docs describe `trustProxy` generically as enabling "`X-Forwarded-*` headers"; the source is more nuanced: `ip()`/`ips()` walk the whole chain via proxy-addr, while `host()`/`protocol()` do a **single distance-0 check of the socket peer only** (helpers-BJvp4oB8.js:1178–1183). The docs don't surface this asymmetry.
3. The docs don't state the default `trustProxy` value; source shows it is `proxyaddr.compile('loopback')` (define_config-BO3FUjx5.js:5520).
4. Docs examples use string presets like `'loopback'`; historical footgun: in early v6, passing raw strings without `defineConfig` normalization threw (adonisjs/http-server issue #62) — current `defineConfig` compiles strings itself (5574–5576).

## Q3 — Cloudflare specifics

From Cloudflare's docs (https://developers.cloudflare.com/fundamentals/reference/http-headers/ and https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/advanced-settings/custom-origin/, checked 2026-08-25):

- **Host header: preserved.** By default Cloudflare sends the original hostname the visitor requested as the `Host` header to the origin. Changing it requires an explicit Origin Rules "Host header override" (paired with a DNS record override in most setups — https://developers.cloudflare.com/rules/origin-rules/features/). So the public domain arrives at the origin in plain `Host`.
- **`X-Forwarded-Host`: not set by Cloudflare.** It does not appear in Cloudflare's HTTP-headers reference; community threads confirm Cloudflare does not add it. (Your own reverse proxy between Cloudflare and the app — e.g. nginx with `proxy_set_header Host backend; proxy_set_header X-Forwarded-Host $host;` — may add it.)
- **`X-Forwarded-For`: appended, visitor-first.** "If there was no existing `X-Forwarded-For` header in the request sent to Cloudflare, `X-Forwarded-For` has an identical value to the `CF-Connecting-IP` header." If the visitor came through their own proxies, Cloudflare appends: visitor → Proxy A → Proxy B → Cloudflare yields `203.0.113.1,198.51.100.101,198.51.100.102`. Cloudflare also always sends `CF-Connecting-IP` (edge→origin only) and `X-Forwarded-Proto`; `True-Client-IP` is the Enterprise-only alias of `CF-Connecting-IP`.
- **What trustProxy people actually need behind Cloudflare:**
  - For `hostname()`: nothing — `Host` is already right (see above).
  - For `ip()`: with default loopback-only trust you log a **Cloudflare edge IP**. Options, in decreasing strictness: (a) trust Cloudflare's published IP ranges (`proxyAddr.compile([...cloudflareIPv4CIDRs, ...cloudflareIPv6CIDRs, 'loopback'])` — ranges from https://www.cloudflare.com/ips/, must be kept up to date); (b) if a local nginx sits in front, trust `['loopback', 'uniquelocal']` and have nginx set the header from `CF-Connecting-IP`; (c) the blunt `trustProxy: () => true`, common in tutorials but it makes `ip()`, `protocol()` and `host()` fully client-spoofable for anyone who can reach the origin directly; (d) the docs-recommended `getIp` reading `request.header('cf-connecting-ip')` with fallback (see Q2) — Adocasts publishes the same recipe (https://adocasts.com/snippets/get-user-ip-address-when-server-is-proxied-by-cloudflare). Note `CF-Connecting-IP` is itself only trustworthy if direct-to-origin traffic is blocked (Cloudflare IP allow-listing / Authenticated Origin Pulls / Tunnel).

## Q4 — Multi-host / edge cases relevant to a logger

- **Comma-joined `X-Forwarded-Host`:** Adonis takes the header verbatim (define_config-BO3FUjx5.js:2022) — no comma splitting, unlike its own `X-Forwarded-Proto` handling (1989) and unlike Express ≥4.17 which takes the first entry. Two trusted proxies each appending yields `hostname()` of `"a.example.com, b.example.com"` (the comma+space survives; only a `:port` suffix after the last entry would be trimmed, and the first entry's port would NOT be — `"a.com:8080, b.com"` keeps `:8080`). A logger indexing on hostname should be aware the value may not be a single clean hostname when `trustProxy` is broad.
- **Missing `Host` (HTTP/1.0):** `Host` is optional in HTTP/1.0; Node passes headers through as-is, so `header('host')` is `undefined` and `hostname()` returns **`null`**. Health-check probes and ancient clients are the usual sources. Loggers must handle `null` (Adonis's own request serializer just emits it, line 2469).
- **HTTP/2 `:authority`:** HTTP/2 clients typically send `:authority` instead of `Host`. Node's http2 compat layer exposes it as `headers[':authority']` and does not copy it into `headers.host`. `host()`/`hostname()` read only `host`, so on a direct HTTP/2 connection they can return `null`; Adonis added `request.authority()` (2040–2042) precisely for this. In practice Adonis apps run HTTP/1.1 behind a TLS-terminating proxy (Cloudflare speaks HTTP/1.1 or h2→h1 to origin and sets `Host`), so this mostly matters for exotic direct-h2 deployments.
- **Spoofability:** with default `trustProxy`, `Host` is client-controlled but constrained by routing (traffic that reaches you via Cloudflare/nginx carries the proxy-set or DNS-matching host); with `trustProxy: () => true`, anyone hitting the origin directly controls hostname, protocol, and IP outright. For **logging** (not routing/auth) that's a data-quality issue rather than a vulnerability, but it matters if logs feed dashboards, rate-limit decisions, or tenant attribution — and header values can carry log-injection payloads (arbitrary unicode, very long strings, commas as shown above). Length-capping and treating hostname as untrusted display data is cheap insurance.

## Implications for the logger

1. **Delegating to `ctx.request.hostname()` is the right call.** It encapsulates the trust logic, strips ports, handles IPv6 brackets, and matches what Adonis's own serializer logs (`hostname:` at 2469). Don't re-read `Host`/`X-Forwarded-Host` manually — you'd duplicate (and likely diverge from) the `trustProxy` semantics.
2. **Behind Cloudflare, the public domain is logged correctly with zero config**, because Cloudflare preserves `Host`. The `trustProxy` caveat only bites when an intermediate proxy *rewrites* `Host` (e.g. nginx `proxy_set_header Host $backend`) and relays the original in `X-Forwarded-Host` — only then must the consumer trust that proxy's IP for `hostname()` to show the public domain. Worth a README note rather than logger logic.
3. **`ip()` is the field that actually needs `trustProxy` behind Cloudflare** (the logger already logs `ctx.request.ip()` — packages/adonis-req-logger/src/log_request.ts:102). Recommend documenting: trust Cloudflare IP ranges or use `http.getIp` with `CF-Connecting-IP`; warn against `() => true`.
4. **Handle `null`:** type the field `string | null` (HTTP/1.0 probes, direct-h2). If a non-null value is wanted for h2 edge cases, `ctx.request.authority()` is the fallback — but it may include a port, so strip it the same way `hostname()` does if used.
5. **Port stripping:** `hostname()` drops the port. If distinguishing `example.com:8080` from `example.com` matters (multi-port deployments), log `ctx.request.host()` instead or additionally — but for the common "public domain behind Cloudflare" ask, portless `hostname()` is cleaner and matches what users expect to group by.
6. **Sanitize for log hygiene:** the value is header-derived; cap length and expect the comma-joined multi-proxy form if consumers set a broad `trustProxy`. Don't parse or validate it as a hostname — record what the framework resolved.
