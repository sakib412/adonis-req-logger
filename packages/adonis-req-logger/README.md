# adonis-req-logger

> Request logging for AdonisJS — one structured, canonical log line per HTTP request, with per-request Lucid query stats.

Emits through your application's existing logger (`config/logger.ts`), so every
pino transport you already use — `pino-pretty`, `pino-loki`, files, Datadog —
works unchanged. No custom transport layer, no storage, near-zero overhead.

```
GET /users/1 200 12ms
```

```jsonc
{
  "level": "info",
  "msg": "GET /users/1 200 12ms",
  "request": {
    "id": "…",
    "method": "GET",
    "url": "/users/1?full=true",
    "route": "/users/:id",
    "host": "api.example.com",
    "ip": "203.0.113.7",
    "user_agent": "…"
  },
  "response": { "status": 200, "content_length": 512 },
  "duration_ms": 12.4,
  "db": { "count": 3, "duration_ms": 4.1 }
}
```

## Installation

```sh
node ace add adonis-req-logger
```

Or install and configure separately:

```sh
npm i adonis-req-logger
node ace configure adonis-req-logger
```

The configure step publishes `config/req_logger.ts`, registers the provider and
the server middleware, and defines the `REQ_LOGGER_ENABLED` env variable.

### Where to register it

The configure step registers the middleware **first** among your server
middleware, which is where it belongs:

```ts
// start/kernel.ts
server.use([
  () => import('adonis-req-logger/req_logger_middleware'), // 👈 first
  () => import('#middleware/container_bindings_middleware'),
  () => import('@adonisjs/cors/cors_middleware'),
])
```

The middleware establishes the scope that per-request query stats are collected
in, so a query run *before* it is invisible to the collector. Registering it
first means queries your own middleware runs — a tenant lookup, an auth token
read — count toward the request that caused them.

If you installed an earlier version, the middleware was registered **last**, and
re-running `node ace configure` will not move it (the codemod leaves an existing
registration alone). Move the line up by hand. Expect `db.count` to rise when you
do: those queries were always happening, they just weren't being counted.

Only query stats are affected by position. The log line itself is written by a
listener wired before the middleware pipeline runs, so **every flushed response
is logged** regardless of where — or whether — the middleware is registered.

## Configuration

```ts
// config/req_logger.ts
import env from '#start/env'
import { defineConfig } from 'adonis-req-logger'

export default defineConfig({
  enabled: env.get('REQ_LOGGER_ENABLED', true),

  /** Named logger (from config/logger.ts) to emit through. Default: app default logger */
  // logger: 'http',

  /** Base level for uneventful requests. Escalations only ever raise it */
  level: 'info',

  /** Override how request.host is resolved. See "Which host gets logged" below */
  // getHost: (ctx, resolveDefault) => ctx.request.header('x-forwarded-host') ?? resolveDefault(),

  /** Paths to never log (string prefix or RegExp) */
  skip: ['/health', '/up'],

  /** Fraction (0..1) of successful requests to log. Errors/slow requests always log */
  sample: 1,

  /** Requests slower than this log at "warn". Number (ms) or "1 second" */
  slowRequestThreshold: 1000,

  /** Per-request Lucid query stats */
  db: {
    enabled: true,
    /** Queries slower than this are itemized. Number (ms) or "100 ms" */
    slowQueryThreshold: 100,
    /** Level for requests that ran a slow query. At/below "level" opts out */
    slowQueryLevel: 'warn',
    /** Max ordinary queries captured per request. Counting continues past the
        cap, and slow queries are always captured */
    maxQueries: 50,
  },
})
```

### Which host gets logged

`request.host` is the domain the client asked for — so one deployment serving
several domains can be split per domain in Grafana, Datadog or wherever your logs
land, instead of only per machine.

By default it is `ctx.request.hostname()`, and for most apps that is already
correct with no configuration: **Cloudflare and most CDNs preserve the original
`Host` header to the origin**, so the public domain is what gets logged.

The value is canonicalized so that one name does not look like several to a log
query — first comma-separated entry, port stripped, lowercased, one trailing dot
removed, capped at 253 characters. It is never *interpreted*: a deploy-stage
prefix like `pr123-shop.example.com` or a tenant subdomain is logged exactly as
it arrived. When no host resolves at all (an HTTP/1.0 client, a bare scanner) the
key is omitted rather than set to `null`.

> **`host` is not `hostname`.** `hostname` conventionally means the *machine*, and
> `pino-loki` promotes a top-level `hostname` field into the Loki stream label. This
> package therefore never emits one — the host lives at `request.host`, in the body.
> Keep it out of your labels too: customer domains are unbounded cardinality.

#### When a proxy rewrites `Host`

If your traffic reaches the app through a chain that terminates before it — say
`CDN → load balancer → SSR server → API` — the inner hop usually rewrites `Host`,
so `request.hostname()` sees an internal ingress host and `request.host` would log
that instead of the customer's domain.

You have two options, and the second is usually the right one:

1. **Widen `app.http.trustProxy`** so the framework honours `X-Forwarded-Host`
   natively. Be aware this is not scoped to the host: the same setting drives
   `request.ip()`, `ips()`, `protocol()` and `secure()`.
2. **Set `getHost`**, which changes only this field:

   ```ts
   // config/req_logger.ts
   export default defineConfig({
     getHost(ctx, resolveDefault) {
       return ctx.request.header('x-forwarded-host') ?? resolveDefault()
     },
   })
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

### Log levels

| Condition                                       | Level                              |
| ----------------------------------------------- | ---------------------------------- |
| Status `5xx`                                    | `error`                            |
| Status `4xx`                                    | `warn`                             |
| Slower than `slowRequestThreshold`              | `warn`                             |
| Ran a query slower than `db.slowQueryThreshold` | `db.slowQueryLevel` (default `warn`) |
| Everything else                                 | `level` (default `info`)           |

When several conditions apply, the most severe level wins — a 5xx response logs
at `error` regardless of the other settings. The base `level` is a floor, not a
cap: escalations only ever raise it. Two useful dials:

- `level: 'debug'` with your logger at `info` keeps routine request lines out
  of the logs entirely, while errors, slow requests, and slow queries still get
  through.
- `slowQueryLevel` at or below `level` opts out of the slow-query escalation —
  such requests are then ordinary: logged at the base level and eligible for
  sampling.

### Database query stats

Lucid only emits query events when the connection has `debug: true`:

```ts
// config/database.ts
connections: {
  sqlite: {
    client: 'better-sqlite3',
    debug: true, // 👈 required for per-request query stats
    // ...
  },
}
```

Stats cover every query inside the logger's scope, which is the whole request
when the middleware is registered first (see
[Where to register it](#where-to-register-it)).

Query **bindings are never captured** — only the parameterized SQL text of slow
queries is itemized. Queries fired outside a request (boot, ace commands,
background jobs) are ignored.

### Pretty printing in development

The package ships a pino-pretty preset that appends the per-request query
stats to the summary line:

```
[13:09:17.033] INFO: GET /demo/users 200 41ms · 1 query 1.9ms
```

```ts
// config/logger.ts
transport: {
  targets: targets()
    .pushIf(!app.inProduction, { target: 'adonis-req-logger/pretty' })
    .toArray(),
},
```

It lives in the package — rather than as pino-pretty options in your config —
because the summary suffix needs a `messageFormat` function, and transport
options cross a worker-thread boundary, so they cannot hold functions.
Requires `pino-pretty` (an optional peer; AdonisJS starter kits already ship
it in development).

### Shipping request logs to Loki (or anywhere)

Define a dedicated logger in `config/logger.ts` and point the request logger at
it — routing, batching, and delivery are handled by pino transports:

```ts
// config/logger.ts
loggers: {
  app: { /* ... */ },
  http: {
    enabled: true,
    level: 'info',
    transport: {
      targets: targets()
        .pushIf(app.inDev, { target: 'adonis-req-logger/pretty' })
        .pushIf(app.inProduction, {
          target: 'pino-loki',
          options: { host: env.get('LOKI_HOST'), labels: { channel: 'http' } },
        })
        .toArray(),
    },
  },
},

// config/req_logger.ts
export default defineConfig({ logger: 'http' })
```

> Tip: enable `generateRequestId: true` in `config/app.ts` (http settings) so
> every record carries a `request.id` you can correlate with error reports.

## Version support

The package's **major version tracks the AdonisJS major it supports**:

| Package version | AdonisJS | Branch | npm tag   | Docs | Status  |
| --------------- | -------- | ------ | --------- | ---- | ------- |
| `7.x`           | v7       | [`main`](https://github.com/sakib412/adonis-req-logger/tree/main) | `latest`  | this README | Active  |
| `5.x`           | v5       | [`v5.x`](https://github.com/sakib412/adonis-req-logger/tree/v5.x) | `adonis5` | [5.x README](https://github.com/sakib412/adonis-req-logger/blob/v5.x/packages/adonis-req-logger/README.md) | Active  |

```sh
npm i adonis-req-logger        # newest, for the current AdonisJS major
npm i adonis-req-logger@^5    # legacy line for AdonisJS v5 apps
```

When a future AdonisJS major introduces breaking changes, it gets a new
package major; previous lines keep receiving fixes on their branches.

## Design

See [docs/ARCHITECTURE.md](https://github.com/sakib412/adonis-req-logger/blob/main/docs/ARCHITECTURE.md) for the full design:
why it hooks `http:request_completed` instead of measuring in middleware, how
query attribution works without the framework's ALS flag, and what is
deliberately excluded from v1.

## License

MIT
