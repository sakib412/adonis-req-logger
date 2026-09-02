# adonis-req-logger

> Request logging for AdonisJS v5 — one structured, canonical log line per HTTP request, with per-request Lucid query stats.

This is the **5.x line** for **AdonisJS v5** (CommonJS), published under the npm
`adonis5` dist-tag from the [`v5.x` branch](https://github.com/sakib412/adonis-req-logger/tree/v5.x).
For AdonisJS v7, use the [7.x line](https://github.com/sakib412/adonis-req-logger/tree/main/packages/adonis-req-logger#readme)
(npm `latest`).

| Package line | AdonisJS | npm tag   | Branch                                                            | Docs                                                                                                       | Status |
| ------------ | -------- | --------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------ |
| 7.x          | v7       | `latest`  | [`main`](https://github.com/sakib412/adonis-req-logger/tree/main) | [7.x README](https://github.com/sakib412/adonis-req-logger/blob/main/packages/adonis-req-logger/README.md) | Active |
| 5.x          | v5       | `adonis5` | [`v5.x`](https://github.com/sakib412/adonis-req-logger/tree/v5.x) | this README                                                                                                | Active |

Emits through your application's logger, so whatever log shipping you already
have works unchanged. No custom transport layer, no storage, near-zero
overhead.

```
GET /users/1 200 12ms
```

```jsonc
{
  "level": "info",
  "msg": "GET /users/1 200 12ms",
  "request": {
    "id": "…", // honors incoming x-request-id
    "method": "GET",
    "url": "/users/1?full=true",
    "route": "/users/:id", // matched pattern — the aggregation key
    "host": "api.example.com", // the domain the client asked for
    "ip": "203.0.113.7",
    "user_agent": "…",
  },
  "response": { "status": 200, "content_length": 512 },
  "duration_ms": 12.4,
  "db": { "count": 3, "duration_ms": 4.1 },
}
```

`request.route` (the pattern, not the URL) is what makes these lines
aggregatable per endpoint — the Adonis-specific advantage over generic
`pino-http`.

## Installation

```sh
npm i adonis-req-logger@adonis5
node ace configure adonis-req-logger
```

The configure step publishes `config/req_logger.ts`, registers the provider,
and adds the package's typings to `tsconfig.json`. It then prints three
manual steps (v5 has no codemods for these):

1. **Register the middleware** — needed only for per-request db stats — in
   `start/kernel.ts`, **first** in the global list:

   ```ts
   Server.middleware.register([
     () => import('@ioc:Adonis/Addons/ReqLoggerMiddleware'),
     () => import('@ioc:Adonis/Core/BodyParser'),
   ])
   ```

   The middleware establishes the scope that query stats are collected in, so
   a query run _before_ it is invisible to the collector. First position means
   queries your own middleware runs — a tenant lookup, an auth token read —
   count toward the request that caused them. If you installed an earlier
   version it was listed last; move the line up and expect `db.count` to rise.
   Only query stats depend on position: the log line itself is written by a
   server hook, so every flushed response is logged regardless.

2. **Enable query reporting** in `config/database.ts` — Lucid only emits
   `db:query` when the connection is in debug mode:

   ```ts
   connections: {
     pg: {
       // ...
       debug: true,
     },
   },
   ```

3. **Enable request ids** in `config/app.ts` (incoming `x-request-id` headers
   are honored either way):

   ```ts
   export const http: ServerConfig = {
     // ...
     generateRequestId: true,
   }
   ```

## Configuration

```ts
// config/req_logger.ts
import { ReqLoggerConfig } from '@ioc:Adonis/Addons/ReqLogger'

const reqLoggerConfig: ReqLoggerConfig = {
  /** Turn request logging on/off */
  enabled: true,

  /** Base level for uneventful requests. Escalations only ever raise it */
  level: 'info',

  /** Override how request.host is resolved. See "Which host gets logged" below */
  // getHost: (ctx, resolveDefault) => ctx.request.header('x-forwarded-host') ?? resolveDefault(),

  /** Paths never logged: exact match or segment-boundary prefix; RegExp tested against the path */
  skip: ['/health'],

  /** Fraction (0-1) of uneventful requests to log. Errors/slow always log */
  sample: 1,

  /** Requests slower than this many milliseconds log at "warn" */
  slowRequestThreshold: 1000,

  /** Extra properties on every request record (child-logger bindings), e.g. { log_type: 'http' } */
  bindings: {},

  /** Per-request Lucid query stats */
  db: {
    enabled: true,
    /** Queries slower than this many milliseconds itemize under db.slow */
    slowQueryThreshold: 100,
    /** Level when the request ran a slow query (values at/below `level` opt out) */
    slowQueryLevel: 'warn',
    /** Capture cap per request; counting continues, slow queries always captured */
    maxQueries: 50,
  },
}

export default reqLoggerConfig
```

To toggle logging via an environment variable, add a rule to `env.ts`
(`REQ_LOGGER_ENABLED: Env.schema.boolean.optional()`) and use
`enabled: Env.get('REQ_LOGGER_ENABLED', true)`.

### Which host gets logged

`request.host` is the domain the client asked for — so one deployment serving
several domains can be split per domain in Grafana, Datadog or wherever your logs
land, instead of only per machine.

By default it is the `Host` header, or `X-Forwarded-Host` when the request came
from a proxy your app trusts (`http.trustProxy` in `config/app.ts`). For most
apps that is already correct with no configuration: **Cloudflare and most CDNs
preserve the original `Host` header to the origin**, so the public domain is
what gets logged.

The value is canonicalized so that one name does not look like several to a log
query — first comma-separated entry, port stripped, lowercased, one trailing dot
removed, capped at 253 characters. It is never _interpreted_: a deploy-stage
prefix like `pr123-shop.example.com` or a tenant subdomain is logged exactly as
it arrived. When no host resolves at all (an HTTP/1.0 client, a bare scanner) the
key is omitted rather than set to `null`.

> **Why not `request.hostname()`?** In AdonisJS v5 (`@adonisjs/http-server`
> 5.12.0) `Request.host()` inverts its trust check: `X-Forwarded-Host` is
> honoured from _untrusted_ peers and ignored from trusted ones. Going through
> it would let any client spoof the logged host and would ignore a proxy you do
> trust. The package therefore applies your `trustProxy` setting itself, the way
> the framework documents it. Keep that in mind if your own code resolves
> tenants from `request.hostname()`.

> **`host` is not `hostname`.** `hostname` conventionally means the _machine_, and
> `pino-loki` promotes a top-level `hostname` field into the Loki stream label. This
> package therefore never emits one — the host lives at `request.host`, in the body.
> Keep it out of your labels too: customer domains are unbounded cardinality.

#### When a proxy rewrites `Host`

If your traffic reaches the app through a chain that terminates before it — say
`CDN → load balancer → SSR server → API` — the inner hop usually rewrites `Host`,
so the default would log an internal ingress host instead of the customer's
domain.

You have two options, and the second is usually the right one:

1. **Widen `http.trustProxy`** so `X-Forwarded-Host` from that hop is honoured.
   Be aware this is not scoped to the host: the same setting drives
   `request.ip()`, `ips()`, `protocol()` and `secure()`.
2. **Set `getHost`**, which changes only this field:

   ```ts
   // config/req_logger.ts
   const reqLoggerConfig: ReqLoggerConfig = {
     getHost(ctx, resolveDefault) {
       return ctx.request.header('x-forwarded-host') ?? resolveDefault()
     },
   }
   ```

   `resolveDefault()` returns the canonicalized default (or `undefined`), so
   `getHost: (ctx, d) => d()` is exactly the default behaviour. Whatever you
   return is canonicalized the same way, so the field's shape never depends on
   your configuration. Return `undefined` to drop the field entirely — that is
   also how a single-domain app opts out.

   The hook is synchronous, and it runs when the response has already been
   flushed, so any request state your middleware set on `ctx` is available. If it
   throws, the field is omitted, the error is reported once, and the log line is
   still written in full.

**Nothing warns you when this is wrong.** A misconfigured deployment logs a
plausible-looking internal host, so verify against real traffic once after
setting it up.

#### Behind Cloudflare or another CDN

The host needs nothing: Cloudflare forwards the visitor's `Host` header to the
origin unchanged, so `request.host` is the public domain out of the box.

`request.ip` is another matter. AdonisJS trusts only loopback peers by default
(`http.trustProxy`), so behind Cloudflare it logs a **Cloudflare edge IP**, not
the visitor. The framework's own `getIp` hook fixes that without touching
`trustProxy`. In v5 the hook replaces the default resolution entirely (there is
no fallback for `undefined`), so fall back explicitly:

```ts
// config/app.ts
import proxyAddr from 'proxy-addr'

const trustProxy = proxyAddr.compile('loopback')

export const http: ServerConfig = {
  // ...
  trustProxy,
  getIp(request) {
    return request.header('cf-connecting-ip') || proxyAddr(request.request, trustProxy)
  },
}
```

Trusting Cloudflare's [published IP ranges](https://www.cloudflare.com/ips/) in
`trustProxy` works too, but has to be kept current. Avoid `trustProxy: () => true`:
anyone who can reach the origin directly then controls the logged IP, protocol
and host. For the same reason `CF-Connecting-IP` is only as trustworthy as your
origin is closed — block direct traffic (Cloudflare IP allow-list, Authenticated
Origin Pulls, or a Tunnel) before relying on it.

## Level escalation

The most severe applicable level wins; `level` is the floor:

- 5xx response → `error`
- 4xx response → `warn`
- Duration ≥ `slowRequestThreshold` → `warn`
- Any query ≥ `db.slowQueryThreshold` → `db.slowQueryLevel`

Sampling (`sample < 1`) only ever drops **uneventful** requests — errored and
slow requests, and requests with slow queries, always log.

## Notes on the v5 line

The 5.x line is a port of the 7.x design onto AdonisJS v5 APIs. Differences
that exist because v5 works differently:

- **No `logger` config knob.** v5 has a single application logger
  (`config/app.ts`), no named-loggers map — records emit through it. The
  `bindings` option is the stand-in: `bindings: { log_type: 'http' }` tags
  every request line so aggregators can split them from application logs
  (e.g. pino-loki's `propsToLabels: ['log_type']` turns it into a Loki
  label). Pretty printing in development is v5's own `prettyPrint` flag
  (pino 6 loads `pino-pretty` in-process; use `pino-pretty@^6`), so the 7.x
  `adonis-req-logger/pretty` transport preset doesn't exist here.

  The host is a body field, so query it with Loki's JSON parser — nested keys
  flatten with `_`:

  ```
  {app="shop-api"} | json | request_host = "eu.example.com"
  sum by (request_host) (count_over_time({app="shop-api"} | json [5m]))
  ```

  Do not promote `request_host` to a label (`propsToLabels`): every customer
  domain would become its own stream, and Loki's cost and limits scale with
  stream count.

- **Thresholds are numbers (milliseconds) only** — duration strings like
  `'1 second'` are a 7.x-only convenience.
- Requests are timed from a server **before hook** to the response's actual
  flush (`on-finished`) — the same semantics as v7's `http:request_completed`
  event, covering 404s and errored requests. 404s never produce `db` stats
  (v5 global middleware doesn't run for unmatched routes; no queries run
  anyway).
- Queries issued **inside the exception handler** are not attributed to the
  request's db stats (they escape the middleware's async scope in v5).

## Requirements

- `@adonisjs/core` ^5.9.0 (AdonisJS v5)
- `@adonisjs/lucid` ^18 — optional, only for db stats
- Node.js >= 14.15.4

## License

MIT
