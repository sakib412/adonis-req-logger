# adonis-req-logger

> Request logging for AdonisJS v5 — one structured, canonical log line per HTTP request, with per-request Lucid query stats.

This is the **5.x line** for **AdonisJS v5** (CommonJS), published under the npm
`adonis5` dist-tag from the [`v5.x` branch](https://github.com/sakib412/adonis-req-logger/tree/v5.x).
For AdonisJS v7, use the [7.x line](https://github.com/sakib412/adonis-req-logger/tree/main/packages/adonis-req-logger#readme)
(npm `latest`).

| Package line | AdonisJS | npm tag | Branch | Status |
| ------------ | -------- | ------- | ------ | ------ |
| 7.x          | v7       | `latest` | [`main`](https://github.com/sakib412/adonis-req-logger/tree/main) | Active |
| 5.x          | v5       | `adonis5` | [`v5.x`](https://github.com/sakib412/adonis-req-logger/tree/v5.x) | Active |

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
    "id": "…",                 // honors incoming x-request-id
    "method": "GET",
    "url": "/users/1?full=true",
    "route": "/users/:id",     // matched pattern — the aggregation key
    "ip": "203.0.113.7",
    "user_agent": "…"
  },
  "response": { "status": 200, "content_length": 512 },
  "duration_ms": 12.4,
  "db": { "count": 3, "duration_ms": 4.1 }
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
   `start/kernel.ts`:

   ```ts
   Server.middleware.register([
     () => import('@ioc:Adonis/Core/BodyParser'),
     () => import('@ioc:Adonis/Addons/ReqLoggerMiddleware'),
   ])
   ```

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

  /** Paths never logged: exact match or segment-boundary prefix; RegExp tested against the path */
  skip: ['/health'],

  /** Fraction (0-1) of uneventful requests to log. Errors/slow always log */
  sample: 1,

  /** Requests slower than this many milliseconds log at "warn" */
  slowRequestThreshold: 1000,

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
  (`config/app.ts`), no named-loggers map — records emit through it. Pretty
  printing in development is v5's own `prettyPrint` flag (pino 6 loads
  `pino-pretty` in-process; use `pino-pretty@^6`), so the 7.x
  `adonis-req-logger/pretty` transport preset doesn't exist here.
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
