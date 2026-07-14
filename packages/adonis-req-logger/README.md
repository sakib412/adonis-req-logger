# adonis-req-logger

> Request logging for AdonisJS — one structured, canonical log line per HTTP request, with per-request Lucid query stats.

> **⚠️ This is the in-progress `v5.x` branch** (AdonisJS v5 line, package 5.x, npm tag `adonis5`). The port is being built ticket by ticket on the [AdonisJS v5 support line map](https://github.com/sakib412/adonis-req-logger/issues/1); the README below still documents the 7.x usage and will be rewritten for v5 before release ([#8](https://github.com/sakib412/adonis-req-logger/issues/8)). For the released 7.x line (AdonisJS v7), see the [`main` branch](https://github.com/sakib412/adonis-req-logger/tree/main/packages/adonis-req-logger#readme).

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

| Package version | AdonisJS | Branch | npm tag   | Status  |
| --------------- | -------- | ------ | --------- | ------- |
| `7.x`           | v7       | `main` | `latest`  | Active  |
| `5.x`           | v5       | `v5.x` | `adonis5` | Planned |

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
