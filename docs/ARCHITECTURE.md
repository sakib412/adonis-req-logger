# adonis-req-logger — Architecture

Request logging for AdonisJS: one structured, canonical log line per HTTP request,
emitted through the application's existing pino-based logger, with optional
per-request database query stats collected from Lucid.

Fills the gap tracked by [adonisjs/core#5102](https://github.com/adonisjs/core/issues/5102)
(an empty roadmap placeholder with no official design as of July 2026).

## Locked decisions

1. **It is a logging library, not a Telescope.** One canonical log line per
   request. No storage, no UI, no custom transport layer — transports belong to
   the user's `config/logger.ts`.
2. **Output routing = named logger.** The config points at a logger name from
   `config/logger.ts`. `pino-loki`, `pino-pretty`, files — all userland logger
   config, zero delivery/storage transport code here. One dev-only exception:
   `pretty.ts`, a pino-pretty *formatting preset* (`adonis-req-logger/pretty`).
   It must live in the package because it needs a `messageFormat` function, and
   transport options cross a worker-thread boundary, so user config cannot hold
   it. It formats; it does not deliver or store.
3. **No formatting configurability in v1.** Fixed, well-designed record shape +
   fixed `msg` summary string (`GET /users/1 200 12ms`). Formatting hooks can be
   added later without a breaking change; removing them later cannot. (The
   pretty preset renders that fixed shape for terminals; it adds no user hooks.)
4. **The DB collector uses its own `AsyncLocalStorage`** — no dependency on the
   framework's `useAsyncLocalStorage` flag. `@adonisjs/lucid` is an *optional*
   peer; the package must work in Lucid-less apps.
5. **Safe by default.** No request/response bodies, no headers beyond
   `user-agent`/`content-length`, and query bindings are *never* captured
   (parameterized SQL text only).

## Runtime flow

```
                 ┌──────────────────────────────────────────────┐
 request ──────▶ │ ReqLoggerMiddleware (server middleware)      │
                 │  • creates RequestStore (WeakMap by ctx)     │
                 │  • requestStorage.run(store, () => next())   │
                 └──────────────────────────────────────────────┘
                        │                          ▲
                        ▼                          │ requestStorage.getStore()
                 (route handler runs)     ┌────────────────────┐
                        │                 │ db:query listener  │
                        │                 │ counts + captures  │
                        │                 │ up to maxQueries   │
                        ▼                 └────────────────────┘
                 ┌──────────────────────────────────────────────┐
                 │ http:request_completed listener              │
                 │  • builds record from ctx + store            │
                 │  • level: base + escalations (5xx→error,     │
                 │    4xx/slow→warn, slow query→slowQueryLevel) │
                 │  • sampling (drops uneventful requests only) │
                 │  • logger.use(config.logger)[level](record)  │
                 └──────────────────────────────────────────────┘
```

Why a middleware *and* an event listener:

- The **middleware** exists only to establish the ALS context + store. It is
  registered as *server* middleware so unmatched routes (404s) are covered.
- The **`http:request_completed` event** is the source of truth for completion.
  Verified against `@adonisjs/http-server` v7 source: the payload is
  `{ ctx, duration: [seconds, nanos] }`, the timer starts before routing, and
  the event fires via `on-finished` when the response is flushed — so it covers
  errored requests (the exception handler has produced the response by then)
  and measures real flush-to-socket duration.
- The finish callback is **not guaranteed to share the middleware's async
  context**, so the listener finds the store via a `WeakMap<HttpContext,
  RequestStore>`, not via ALS. ALS exists for the *collectors* (`db:query` is
  emitted inside the request's async execution, so context flows to it).
- The listener is self-sufficient: if the middleware is not registered,
  requests still log — only collector data (db stats) is missing.

## DB collection (verified against Lucid v22)

- Lucid emits `db:query` **only when the connection has `debug: true`** in
  `config/database.ts`. The provider warns once at boot if `db.enabled` is on
  but no connection has debug enabled.
- Payload: `{ connection, model?, ddl?, duration?: [number, number], method,
  sql, bindings?, inTransaction? }`. Durations are hrtime tuples, normalized to
  ms centrally.
- Aggregate by default (`db: { count, duration_ms }`); queries over
  `slowQueryThreshold` are itemized under `db.slow`. Ordinary-query capture
  stops at `maxQueries` (counting continues; record gets `db.truncated: true`)
  so an N+1 disaster can't balloon a log record — but slow queries are captured
  even past the cap, so they always itemize, escalate, and exempt from sampling.
- Queries emitted outside a request (boot, ace commands, background jobs) have
  no store and are ignored.

## The record (fixed shape, v1)

```jsonc
{
  "level": "info",
  "msg": "GET /users/1 200 12ms",
  "request": {
    "id": "…",                 // request.id(); honors incoming x-request-id
    "method": "GET",
    "url": "/users/1?full=true",
    "route": "/users/:id",     // matched pattern — the aggregation key
    "ip": "203.0.113.7",
    "user_agent": "…",
    "content_length": 42       // omitted when the header is absent
  },
  "response": { "status": 200, "content_length": 512 },
  "duration_ms": 12.4,
  "db": { "count": 3, "duration_ms": 4.1 }   // present when db collection is on
}
```

`request.route` (the pattern, not the URL) is what makes logs aggregatable per
endpoint — the Adonis-specific advantage over generic `pino-http`.

## Package layout (AdonisJS conventions)

```
packages/adonis-req-logger/
├── index.ts                        # exports: configure, defineConfig, stubsRoot,
│                                   #   REQUEST_LOG_LEVELS, types
├── configure.ts                    # `node ace configure adonis-req-logger`
├── pretty.ts                       # dev pino-pretty preset (see locked decision 2)
├── providers/req_logger_provider.ts
├── src/
│   ├── types.ts
│   ├── levels.ts                   # REQUEST_LOG_LEVELS + severity helpers
│   ├── define_config.ts            # applies defaults, validates
│   ├── request_store.ts            # ALS + WeakMap + store factory
│   ├── req_logger_middleware.ts
│   ├── log_request.ts              # record builder + level + sampling + emit
│   └── collectors/db_collector.ts
└── stubs/
    ├── main.ts                     # stubsRoot
    └── config/req_logger.stub
```

- `configure.ts` uses assembler codemods: `makeUsingStub` (config file),
  `updateRcFile` (provider), `registerMiddleware('server', …)`,
  `defineEnvVariables` + `defineEnvValidations` (`REQ_LOGGER_ENABLED`).
- Peer deps: `@adonisjs/core ^7` (required), `@adonisjs/lucid` (optional —
  the `db:query` listener is typed structurally with defensive optional
  fields, which is why the `>=21` range is safe despite verifying against
  v22), `pino-pretty` (optional — only needed for `adonis-req-logger/pretty`).
- ESM-only, snake_case filenames, built with `tsc` to `build/`.

## Config surface (entire v1 API)

```ts
export default defineConfig({
  enabled: env.get('REQ_LOGGER_ENABLED', true),
  logger: undefined,            // named logger (keyof LoggersList); undefined = app default
  level: 'info',                // base level; escalations only ever raise it
  skip: ['/health', '/up'],     // exact path / segment-boundary prefix, or RegExp
  sample: 1,                    // drops uneventful requests only
  slowRequestThreshold: 1000,   // ms or '1 second' → escalates level to warn
  db: { enabled: true, slowQueryThreshold: 100, slowQueryLevel: 'warn', maxQueries: 50 },
})
```

Deliberately excluded from v1 (addable later without breaking changes):
transform/message hooks, header/body capture, custom sinks, sampling functions,
an `err` field on the record (needs a clean hook into the exception handler —
for now the request id correlates with the exception handler's own report).

## Versioning & support policy

The package **major tracks the AdonisJS major it supports**; minors/patches
within a line are normal semver for the package's own changes.

- `main` targets the newest supported AdonisJS major and publishes as npm
  `latest` (currently `7.x` ↔ AdonisJS v7).
- Older AdonisJS majors live on `vN.x` branches and publish under a matching
  dist-tag (planned: `5.x` on branch `v5.x`, tag `adonis5`, for AdonisJS v5).
  Fixes land on `main` first and are back-ported when applicable.
- A future AdonisJS breaking release (v8, …) gets a new package major from a
  new branch cut; previous lines stay in maintenance.
- `peerDependencies` enforce the pairing at install time
  (`@adonisjs/core ^7` for the 7.x line).

The AdonisJS v5 line is a port, not a re-release: v5 is CommonJS, has no
`http:request_completed` event (timing must be middleware-based), uses
`instructions.md` templates instead of configure codemods, and pairs with
Lucid v18 — so it is maintained as its own implementation on its branch.

## Roadmap

1. **Skeleton** — configure flow, middleware + completed-listener, record
   builder, skip/sample/levels. ✅ shipped
2. **DB collector** — per-request query stats + boot-time debug-flag warning.
   The differentiator. ✅ shipped (first release: `7.0.0`)
3. **Next (7.x)** — test suite, CI (lint/typecheck/test matrix, publint,
   provenance), auth user-id enrichment (guarded), autocannon benchmark
   published in README, docs polish.
4. **5.x line** — AdonisJS v5 legacy port on branch `v5.x` (see Versioning &
   support policy above).
