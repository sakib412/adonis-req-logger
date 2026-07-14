# AdonisJS v5 + Lucid v18 API surface — verified findings

Resolves [sakib412/adonis-req-logger#2](https://github.com/sakib412/adonis-req-logger/issues/2), part of the
[AdonisJS v5 support line map](https://github.com/sakib412/adonis-req-logger/issues/1).

Verified 2026-07-14 against: pinned GitHub tags (`adonisjs/http-server@v5.12.0`, `adonisjs/core@v5.9.0`, `adonisjs/logger@v4.1.6`, `adonisjs/lucid@v18.4.2`, `adonisjs/redis@v7.3.4`, `adonisjs/sink@v5.4.3`, `adonisjs/events@v7.2.1`), the published npm tarballs of the same versions (extracted and grepped locally), the v5 docs site (`v5-docs.adonisjs.com`) and its source repo (`adonisjs/v5-docs`), and `npm view` against the live registry.

---

## 1. Request lifecycle & timing (`@adonisjs/http-server` 5.12.0)

### Global middleware — registered in `start/kernel.ts`, does NOT run for 404s

- Registration: `Server.middleware.register([() => import(...)])` in `start/kernel.ts` — see the v5 app boilerplate template ([create-adonis-ts-app `templates/web/start/kernel.txt`](https://github.com/adonisjs/create-adonis-ts-app), verified from npm tarball `create-adonis-ts-app@4.2.7`) and the [middleware guide](https://v5-docs.adonisjs.com/guides/middleware).
- The middleware guide states explicitly: *"AdonisJS does not execute the middleware chain, if there is no registered route for the current HTTP request."*
- Source confirmation: [`RequestHandler.handle()`](https://github.com/adonisjs/http-server/blob/v5.12.0/src/Server/RequestHandler/index.ts) calls `findRoute(ctx)` **first**, which throws `E_ROUTE_NOT_FOUND` before the co-compose middleware runner ever starts. So a global middleware never sees unmatched requests.
- Exception handler runs **outside** the middleware chain: [`Server.handleRequest()`](https://github.com/adonisjs/http-server/blob/v5.12.0/src/Server/index.ts) does `try { await this.runBeforeHooksAndHandler(ctx) } catch (error) { await this.exception.handle(error, ctx) }`. An error thrown in a route handler unwinds through the middleware `await next()` frames, escapes the chain, and only *then* does the [`ExceptionManager`](https://github.com/adonisjs/http-server/blob/v5.12.0/src/Server/ExceptionManager/index.ts) set the status/body ([exception-handling guide](https://v5-docs.adonisjs.com/guides/exception-handling): *"The exceptions raised during an HTTP request are forwarded to the global exception handler stored inside the `app/Exceptions/Handler.ts` file"*). Consequence: a logging middleware's `finally` block reads the response **before** the exception handler has written the real status code.

### `Server.hooks.before` / `Server.hooks.after` — cover 404s and errors

From [`src/Server/index.ts`](https://github.com/adonisjs/http-server/blob/v5.12.0/src/Server/index.ts) and [`src/Server/Hooks/index.ts`](https://github.com/adonisjs/http-server/blob/v5.12.0/src/Server/Hooks/index.ts):

- **Before hooks** run first thing in `handleRequest`, *before route matching* → they run for every request including 404s. A before hook short-circuits the rest of the pipeline only if it sets a response (`ctx.response.hasLazyBody || !ctx.response.isPending`); a passive logging hook never short-circuits.
- **After hooks** run after the handler *or* after the exception handler, and always before the body is written:
  ```ts
  try {
    await this.runBeforeHooksAndHandler(ctx)
  } catch (error) {
    await this.exception.handle(error, ctx)
  }
  try {
    await this.hooks.executeAfter(ctx)
    requestAction.end({ status_code: res.statusCode })
    ctx.response.finish()
  } catch (error) { ... }
  ```
  So after hooks cover 404s and errored requests too — but they fire **before `ctx.response.finish()`**, i.e. before body serialization and the socket write. They are the wrong place to measure flush duration; they are the right place to still mutate the response.
- **Registration timing gotcha (source-verified):** `server.optimize()` calls `hooks.commit()`, which replaces `executeBefore`/`executeAfter` with no-ops *if the hook arrays are empty at that moment* ([Hooks#commit](https://github.com/adonisjs/http-server/blob/v5.12.0/src/Server/Hooks/index.ts)). The boot order in core is: `kernel.boot()` (register providers → boot providers → preloads) → `createHttpServer()` which calls `server.optimize()` → `application.start()` which runs providers' `ready()` ([`src/Ignitor/HttpServer/index.ts`](https://github.com/adonisjs/core/blob/v5.9.0/src/Ignitor/HttpServer/index.ts), [`src/utils/index.ts`](https://github.com/adonisjs/core/blob/v5.9.0/src/utils/index.ts)). **Hooks must therefore be registered in a provider's `boot()` (or a preload file) — `ready()` is too late.**
- The v5 docs never document `Server.hooks` (verified against the full [v5-docs guides list](https://github.com/adonisjs/v5-docs/tree/develop/content/guides)); it is public API on `ServerContract` but source-documented only.

### Completion hook — no event exists; use on-finished on the raw `ServerResponse`

- **There is no request-completed event in v5.** No `http:*` events at all (next section).
- v5's http-server *depends on* `on-finished@^2.4.1` ([package.json](https://github.com/adonisjs/http-server/blob/v5.12.0/package.json)) but uses it **only inside [`Response#streamBody`](https://github.com/adonisjs/http-server/blob/v5.12.0/src/Response/index.ts)** for stream cleanup — not for any lifecycle notification (verified by grepping the whole published build: single usage site).
- What `Response` exposes ([`adonis-typings/response.ts`](https://github.com/adonisjs/http-server/blob/v5.12.0/adonis-typings/response.ts), [`src/Response/index.ts`](https://github.com/adonisjs/http-server/blob/v5.12.0/src/Response/index.ts)):
  - `response.response: ServerResponse` — the **public raw Node response** (also `response.request: IncomingMessage`).
  - `response.finished: boolean` → `this.response.writableFinished`; `response.headersSent`; `response.isPending`.
- Therefore the reliable flush-to-socket hook is: from a **before hook**, capture `process.hrtime()` and attach `onFinished(ctx.response.response, cb)` (or `ctx.response.response.once('finish', ...)` plus close/error handling — on-finished is safer and is already the mechanism the v7 design relied on). The callback fires when the response is flushed, exactly matching v7's `http:request_completed` timing semantics, and covers 404s and errors because before hooks do.

### No `http:*` events on the Event emitter

- Grep of the published builds of `@adonisjs/core@5.9.0` and `@adonisjs/http-server@5.12.0` shows **zero `.emit(` calls** into the app emitter and no `http:` event names anywhere. The [events guide](https://v5-docs.adonisjs.com/guides/events) documents no HTTP lifecycle events. The only framework `EventsList` augmentations in this stack are packages like Lucid (`db:query`) and Redis. `http:request_completed`/`http:request_finished` are v6+ (`@adonisjs/http-server` ≥ 6) constructs; nothing equivalent exists in 5.x.

---

## 2. Logger (`@adonisjs/logger` 4.1.6 — the v5-era line)

- **Version reality check:** core 5.9.0 does not depend on `@adonisjs/logger` directly; it flows through `@adonisjs/application@^5.3.0` → `@adonisjs/logger@^4.1.5` (npm view, 2026-07-14). Latest 4.x is **4.1.6**. There is no stable "logger 5.x" — the 5.0.0-0…5.4.2-8 releases on npm are v6-era prereleases.
- **Config shape:** a single `logger` export in `config/app.ts` typed `LoggerConfig` — fields per [`adonis-typings/logger.ts`](https://github.com/adonisjs/logger/blob/v4.1.6/adonis-typings/logger.ts): `name`, `level`, `enabled`, `messageKey?`, `timestamp?` (`iso|unix|epoch` keyword or pino TimeFn), `customLevels?`, `formatters?`, `redact?`, **`prettyPrint?: boolean | PrettyOptions`**, `base?`, `serializers?`, `stream?`, plus arbitrary pino options. The stock template sets `prettyPrint: Env.get('NODE_ENV') === 'development'` ([core `templates/config/app.txt`](https://github.com/adonisjs/core/blob/v5.9.0/templates/config/app.txt)). **Single logger only — no named/multi-logger support, no `config/logger.ts`** ([logger guide](https://v5-docs.adonisjs.com/guides/logger): config lives *"inside the `config/app.ts` file under the `logger` export"*; the only isolation mechanism is `child()`).
- **Pino major: 6.** `@adonisjs/logger@4.1.6` depends on `pino@^6.14.0` and `@types/pino@^6.3.12` ([package.json](https://github.com/adonisjs/logger/blob/v4.1.6/package.json)); options are passed straight to `Pino(options)` ([`src/getPino.ts`](https://github.com/adonisjs/logger/blob/v4.1.6/src/getPino.ts)). Pino 6 has **no worker-thread transports**; `prettyPrint` loads `pino-pretty` **in-process** (the v5 scaffolder installs `pino-pretty` into every new app — `pkg.install('pino-pretty')` in `create-adonis-ts-app@4.2.7` `build/tasks/InstallDependencies/index.js`). **Conclusion: the `adonis-req-logger/pretty` worker-thread preset export is meaningless on v5 and should be dropped; v5 handles pretty-printing natively via the `prettyPrint` config flag.**
- **`ctx.logger` is a per-request child logger:** `Server.getContext()` builds it as `this.application.logger.child({ request_id: request.id() })` ([`src/Server/index.ts`](https://github.com/adonisjs/http-server/blob/v5.12.0/src/Server/index.ts)); typed `logger: LoggerContract` on `HttpContextContract` ([`adonis-typings/context.ts`](https://github.com/adonisjs/http-server/blob/v5.12.0/adonis-typings/context.ts)). The `request_id` binding is `undefined` unless the header is present or generation is enabled (section 3); [docs](https://v5-docs.adonisjs.com/guides/logger): *"It is an isolated child instance of the logger that adds the unique request-id to all the log messages."*
- **Container binding & contract:** `@ioc:Adonis/Core/Logger`; `LoggerContract` has `trace/debug/info/warn/error/fatal/log`, each with pino-style overloads — `(message, ...values)` **and `(mergingObject, message, ...values)`** — plus `child(bindings, { level?, redact?, serializers? })`, `isLevelEnabled()`, `bindings()`, `level`, `levelNumber`, `levels`, `pinoVersion` ([`adonis-typings/logger.ts`](https://github.com/adonisjs/logger/blob/v4.1.6/adonis-typings/logger.ts)).

---

## 3. Request id

From [`src/Request/index.ts`](https://github.com/adonisjs/http-server/blob/v5.12.0/src/Request/index.ts):

```ts
public id(): string | undefined {
  let requestId = this.header('x-request-id')
  if (!requestId && this.config.generateRequestId) {
    requestId = cuid()
    this.request.headers['x-request-id'] = requestId
  }
  return requestId
}
```

- **Honors an incoming `x-request-id` header unconditionally** (docs: *"the request-id is only generated when the `X-Request-Id` header is not set"* — [request guide](https://v5-docs.adonisjs.com/guides/request)).
- Generates a `cuid()` (from `@poppinss/utils`) only when `http.generateRequestId` is true, and writes it back onto the incoming headers.
- **Default is off:** `generateRequestId: false` in the stock config template ([core `templates/config/app.txt`](https://github.com/adonisjs/core/blob/v5.9.0/templates/config/app.txt)); the flag lives on `RequestConfig` ([`adonis-typings/request.ts`](https://github.com/adonisjs/http-server/blob/v5.12.0/adonis-typings/request.ts)). The port's README must tell users to enable it (same as the logger guide does).

---

## 4. Lucid v18 `db:query`

- **Emitter:** the app-level emitter. `DatabaseProvider.registerDatabase()` resolves `'Adonis/Core/Event'` and passes it into `new Database(config, Logger, Profiler, Emitter)` ([`providers/DatabaseProvider.ts`](https://github.com/adonisjs/lucid/blob/v18.4.2/providers/DatabaseProvider.ts)). `@ioc:Adonis/Core/Event` is `@adonisjs/events` 7.x, built on **emittery** — listeners are invoked asynchronously ([events guide](https://v5-docs.adonisjs.com/guides/events), [`@adonisjs/events` v7.2.1 source](https://github.com/adonisjs/events/blob/v7.2.1/src/Emitter/index.ts)).
- **Event name & payload type** — [`adonis-typings/events.ts`](https://github.com/adonisjs/lucid/blob/v18.4.2/adonis-typings/events.ts) augments `EventsList` with `'db:query': DbQueryEventNode`, and [`adonis-typings/database.ts`](https://github.com/adonisjs/lucid/blob/v18.4.2/adonis-typings/database.ts) defines:
  ```ts
  export type DbQueryEventNode = {
    connection: string
    model?: string
    ddl?: boolean
    duration?: [number, number]   // hrtime tuple, NOT a number
    method: string
    sql: string
    bindings?: any[]
    inTransaction?: boolean
  }
  ```
  Runtime construction ([`src/QueryReporter/index.ts`](https://github.com/adonisjs/lucid/blob/v18.4.2/src/QueryReporter/index.ts)): `duration = process.hrtime(startTime)`; `sql`/`bindings`/`method` come from knex's `'query'` event spread into the data ([`src/QueryRunner/index.ts`](https://github.com/adonisjs/lucid/blob/v18.4.2/src/QueryRunner/index.ts)); `connection` + `inTransaction` from the query builder's `getQueryData()` ([`src/Database/QueryBuilder/Database.ts`](https://github.com/adonisjs/lucid/blob/v18.4.2/src/Database/QueryBuilder/Database.ts)); `model` added by the ORM query builder; `ddl: true` added by Schema/migration queries ([`src/Schema/index.ts`](https://github.com/adonisjs/lucid/blob/v18.4.2/src/Schema/index.ts)). **Undocumented extra:** the emitted object also carries `error` (`{ duration, ...data, error }`) which is absent from the declared type — a failed query still emits, with `error` set.
- **Emission condition** (source, `QueryReporter#initStartTime`): the event fires only when **both** are true — `client.emitter.hasListeners('db:query')` **and** `debug` is enabled (connection-level `debug: true` in `config/database.ts`, or per-query `.debug(true)`). The [debugging guide](https://v5-docs.adonisjs.com/guides/database/debugging) confirms: set `debug: true` to enable `db:query` globally. The stock config template ships `debug: false` ([`templates/database.txt`](https://github.com/adonisjs/lucid/blob/v18.4.2/templates/database.txt)).
- **There is no `prettyPrint` config flag in v5 Lucid** (that's v6's `prettyPrintDebugQueries`). In v5, pretty printing is done by attaching the helper as a listener: `Event.on('db:query', Database.prettyPrint)` ([`src/Helpers/prettyPrint.ts`](https://github.com/adonisjs/lucid/blob/v18.4.2/src/Helpers/prettyPrint.ts), [debugging guide](https://v5-docs.adonisjs.com/guides/database/debugging)). Also note: v18 logs a deprecation-style warning about the connection logger's legacy debug output, recommending the `db:query` event ([`src/Connection/Logger.ts`](https://github.com/adonisjs/lucid/blob/v18.4.2/src/Connection/Logger.ts)).
- **How a package listens:** resolve `'Adonis/Core/Event'` in the provider (`this.app.container.resolveBinding('Adonis/Core/Event')`) and `Event.on('db:query', (query: DbQueryEventNode) => ...)` — fully typed through the `EventsList` augmentation once `@adonisjs/lucid` typings are in the consumer's tsconfig `types`.

---

## 5. v5 package conventions

### The `adonisjs` package.json block (semantics verified in sink 5.4.3 source)

All keys and their exact behavior, from [`sink src/Tasks/Instructions/index.ts`](https://github.com/adonisjs/sink/blob/v5.4.3/src/Tasks/Instructions/index.ts) and [`src/Tasks/TemplatesManager/index.ts`](https://github.com/adonisjs/sink/blob/v5.4.3/src/Tasks/TemplatesManager/index.ts), executed by `node ace configure <pkg>`:

| Key | Semantics |
|---|---|
| `types` | Package name appended to the app's tsconfig `compilerOptions.types` (pulls in your ambient `@ioc:` typings via your package's top-level `"types"` field) |
| `providers` / `aceProviders` / `testProviders` | Added to `.adonisrc.json` |
| `commands` | Added to `.adonisrc.json` commands |
| `aliases` | Written to `.adonisrc.json` aliases **and** tsconfig `compilerOptions.paths` |
| `templates` | `basePath` (default `'./build/templates'`); keyed by target directory (`config`, `contracts`, `database`, …); entries are `"file.txt"` (dest = src minus extension) or `{ src, dest, mustache?, data? }`; **dest gets `.ts` appended when it has no extension** (redis's `{src: 'config.txt', dest: 'redis'}` → `config/redis.ts`); rendering is `TemplateLiteralFile` (JS template-literal interpolation) by default, `MustacheFile` when `mustache: true` — Lucid's own `database.txt` uses mustache sections (`{{#sqlite}}…{{/sqlite}}`) via its instructions script |
| `env` | Key/values written to `.env` / `.env.example` |
| `preloads`, `metaFiles` | Added to `.adonisrc.json` |
| `instructions` | Path to a JS file executed as `instructionsFn(projectRoot, application, sink)` — signature verified in [Lucid's `instructions.ts`](https://github.com/adonisjs/lucid/blob/v18.4.2/instructions.ts): `export default async function instructions(projectRoot: string, app: ApplicationContract, sink: typeof sinkStatic)`; the sink API used there: `sink.files.MustacheFile/EnvFile/PackageJsonFile`, `sink.getPrompt()`, `sink.logger` |
| `instructionsMd` | Markdown rendered after configure (terminal or browser, user's choice) |

Real-world blocks: [lucid 18.4.2 package.json](https://github.com/adonisjs/lucid/blob/v18.4.2/package.json) (`instructions` + `instructionsMd` + `types` + `providers` + `commands` + `templates`), [redis 7.3.4 package.json](https://github.com/adonisjs/redis/blob/v7.3.4/package.json) (`instructionsMd` + `templates.config`/`templates.contracts` + `types` + `providers` + `env` — the closest model for this port), [core 5.9.0 package.json](https://github.com/adonisjs/core/blob/v5.9.0/package.json).

### Provider class shape

Verified in [Lucid's DatabaseProvider](https://github.com/adonisjs/lucid/blob/v18.4.2/providers/DatabaseProvider.ts) and [Redis's RedisProvider](https://github.com/adonisjs/redis/blob/v7.3.4/providers/RedisProvider.ts):

```ts
export default class MyProvider {
  public static needsApplication = true
  constructor(protected app: ApplicationContract) {}
  public register() {}          // bind into this.app.container (container.singleton/bind)
  public boot() {}              // all bindings present; safe to resolve; register Server hooks HERE
  public async ready() {}       // after server starts accepting connections (web env)
  public async shutdown() {}    // graceful cleanup
}
```

Lifecycle order (`registered → booted (providers boot + preload files) → ready`) verified in [core's Ignitor/Kernel](https://github.com/adonisjs/core/blob/v5.9.0/src/Ignitor/Kernel/index.ts) and the [application guide](https://v5-docs.adonisjs.com/guides/application) (boot lifecycle diagram; *"you can access the IoC container bindings once the application state is set to `booted`"*). Optional-dependency wiring uses `this.app.container.withBindings([...], cb)` (Lucid uses this for HealthCheck/Validator/Repl).

### Typings & binding namespace

- Pattern: ship an `adonis-typings/` folder of `declare module '@ioc:...'` augmentations, referenced from a top-level `index.ts`, and point package.json `"types"` at the built `adonis-typings/index.d.ts` (redis does exactly this; its `exports` map: `".": { "types": "./build/adonis-typings/index.d.ts", "require": "./build/providers/RedisProvider.js" }`).
- Namespace convention for non-core packages: **`@ioc:Adonis/Addons/X`** — verified: redis binds `'Adonis/Addons/Redis'` and declares [`declare module '@ioc:Adonis/Addons/Redis'`](https://github.com/adonisjs/redis/blob/v7.3.4/adonis-typings/redis.ts). For this port: `@ioc:Adonis/Addons/ReqLogger`.
- Cross-package augmentation (e.g. adding to `EventsList` or config contracts) is the same `declare module '@ioc:Adonis/Core/Event'` pattern Lucid uses.

### Build & toolchain

- **CJS**: no `"type": "module"` in lucid/redis/core; `"main"` points at the built provider (`build/providers/XProvider.js`). An `exports` map is optional (lucid has none; redis has a `require`-conditional one).
- **TypeScript**: v5-era devDependencies — lucid 18.4.2: `typescript@4.8.4`; http-server 5.12.0: `^4.8.4`; core 5.9.0: `^4.9.3`. The v5.x branch should compile with **TS ~4.9**, not the TS 7 used on `main`.
- **Node floor**: [installation guide](https://v5-docs.adonisjs.com/guides/installation): *"at least the latest release of Node.js v14"*; lucid 18.4.2 `engines`: `node >=14.15.4`. (core/http-server publish no `engines` field.)

### npm registry today (`npm view`, 2026-07-14)

| Package | Latest in-range version | Notes |
|---|---|---|
| `@adonisjs/core` | **5.9.0** (5.x line; `latest` dist-tag is 7.3.5) | Direct deps include `@adonisjs/http-server@^5.12.0`, `@adonisjs/events@^7.2.1`, `@adonisjs/application@^5.3.0` — **core bundles http-server directly; logger comes transitively via application → `@adonisjs/logger@^4.1.5`** |
| `@adonisjs/http-server` | **5.12.0** (latest 5.x) | dep: `on-finished@^2.4.1` |
| `@adonisjs/logger` | **4.1.6** (latest 4.x = v5-era line) | dep: `pino@^6.14.0` |
| `@adonisjs/lucid` | **18.4.2** (latest 18.x) | peerDep: `@adonisjs/core@^5.1.0` |
| `@adonisjs/sink` | **5.4.3** (latest published overall) | lucid 18.4.2 pairs `@adonisjs/sink@^5.4.3` as devDep |
| `@adonisjs/events` | **7.2.1** (latest 7.x) | emittery-based |

---

## 6. AsyncLocalStorage

- v5 has its own **optional** ALS for `HttpContext`: `useAsyncLocalStorage?: boolean` on the http config ([`adonis-typings/request.ts`](https://github.com/adonisjs/http-server/blob/v5.12.0/adonis-typings/request.ts)), **default false** (`useAsyncLocalStorage(httpConfig.useAsyncLocalStorage || false)` in the [Server constructor](https://github.com/adonisjs/http-server/blob/v5.12.0/src/Server/index.ts)). When enabled, the entire `handleRequest` (before hooks → middleware → handler → exception handler → after hooks → `response.finish()`) runs inside `httpContextLocalStorage.run(ctx, ...)` ([`src/HttpContext/LocalStorage/index.ts`](https://github.com/adonisjs/http-server/blob/v5.12.0/src/HttpContext/LocalStorage/index.ts)); consumers use `HttpContext.get()` ([ALS guide](https://v5-docs.adonisjs.com/guides/async-local-storage)).
- **No conflict** with a package running its own `AsyncLocalStorage` instance — Node ALS instances are independent; the framework's is a separate instance wrapping a wider scope. It is irrelevant to this port's design *except* as an opportunity (see delta 4).
- One scope caveat found in source: a **middleware-established** ALS `run()` only wraps the downstream middleware chain + route handler. Exception handler, after hooks, and `response.finish()` execute *outside* it (they're outside the middleware chain, section 1). Queries executed in an exception handler would escape a middleware-scoped ALS store — attribute stats by `ctx` (WeakMap) rather than by ALS scope wherever possible.

---

## Port deltas (7.x design → 5.x)

1. **`http:request_completed` event → does not exist.** No emitter-based HTTP lifecycle events at all in v5. Replacement: register a `Server.hooks.before` hook **in the provider's `boot()`** (not `ready()` — `hooks.commit()` no-ops empty hook lists during `server.optimize()`, which runs before `ready()`), stamp `process.hrtime()` on the ctx, and attach `onFinished(ctx.response.response, cb)`; build and emit the log record inside the on-finished callback. This reproduces v7 semantics exactly (v7's event is itself fired via on-finished), including 404 and errored-request coverage, with `duration = process.hrtime(start)` giving the same `[sec, nanos]` tuple. Add `on-finished@^2.4.1` (+ `@types/on-finished`) as a direct dependency — do not reach into http-server's internals for it.
2. **Server middleware (runs for unmatched routes in v7) → v5 global middleware skips 404s.** Do not port the middleware as the primary mechanism. If per-request ALS is still wanted (delta 4), the before hook can do everything the v7 server middleware did; a global middleware is only needed if the ALS scope must wrap the handler for query attribution — and it will miss 404s (harmless: no queries run for 404s) and exception-handler-issued queries (flag in README).
3. **`logger.use(name)` / `config/logger.ts` named logger → no multi-logger support in v5.** Replacement: emit through a child of the app logger — `Logger.child({ module: 'req_logger' })` (binding `@ioc:Adonis/Core/Logger`) or through `ctx.logger` (already carries `request_id`). All level methods accept a pino-style merging-object first argument, so the one-line structured record ports unchanged.
4. **ALS store keyed via server-middleware → prefer WeakMap keyed by `HttpContext`.** The `db:query` listener needs the current ctx: either (a) run the package's own ALS from a global middleware and read it in the listener (async context propagates through emittery's async dispatch since the emit happens inside the query's async chain), or (b) if the app has `useAsyncLocalStorage: true`, use `HttpContext.get()` with zero extra plumbing. Recommend (a) as default with (b) as documented fast-path; stats aggregate into a WeakMap keyed by ctx so the on-finished record builder is ALS-independent.
5. **`adonis-req-logger/pretty` (pino v7 worker-thread transport preset) → drop it.** v5 = pino 6: no transports, no worker boundary; pretty-printing is the framework's own `prettyPrint` flag in `config/app.ts` loading `pino-pretty` in-process. Nothing for the package to ship.
6. **assembler-codemod `configure.ts` → package.json `adonisjs` block.** Config template ships as `templates.config: [{ src: 'config.txt', dest: 'req_logger' }]` (→ `config/req_logger.ts`, template-literal or mustache rendering), plus `types`, `providers`, and optionally `instructionsMd`; a JS `instructions` file is only needed for prompts/env-var logic. Read config in the provider via `this.app.container.resolveBinding('Adonis/Core/Config').get('req_logger', {})`.
7. **ESM → CJS.** No `"type": "module"`; `"main": "./build/providers/ReqLoggerProvider.js"`; `"types": "./build/adonis-typings/index.d.ts"`; container binding namespaced `@ioc:Adonis/Addons/ReqLogger`; compile with TypeScript ~4.9 on the `v5.x` branch.
8. **`db:query` payload shape differs:** v5 Lucid's `duration` is an **hrtime tuple** (`[number, number]`), fields per `DbQueryEventNode` above (plus undeclared `error`). Emission requires **both** `debug: true` on the connection **and** a registered listener — the package's listener satisfies the second condition, but the README must instruct enabling `debug: true` (default template ships `debug: false`). No `prettyPrintDebugQueries` equivalent exists in v5 — irrelevant to the port, but don't document it.
9. **Request id off by default (same as v7 but different flag location):** document setting `http.generateRequestId: true` in `config/app.ts`; incoming `x-request-id` is honored automatically.

## Recommended peer/dev dependency matrix

```jsonc
// package.json (v5.x branch, publishes as 5.x)
{
  "main": "./build/providers/ReqLoggerProvider.js",
  "types": "./build/adonis-typings/index.d.ts",
  "engines": { "node": ">=14.15.4" },            // matches lucid 18.4.2 engines; docs floor is Node 14
  "dependencies": {
    "on-finished": "^2.4.1"                       // same range as @adonisjs/http-server@5.12.0
  },
  "peerDependencies": {
    "@adonisjs/core": "^5.9.0",                   // first-party v5 addons used ^5.1.0; ^5.9.0 pins the APIs verified here
    "@adonisjs/lucid": "^18.0.0"                  // query stats only
  },
  "peerDependenciesMeta": {
    "@adonisjs/lucid": { "optional": true }
  },
  "devDependencies": {
    "@adonisjs/core": "5.9.0",
    "@adonisjs/lucid": "18.4.2",
    "@adonisjs/sink": "^5.4.3",                   // pairing used by lucid 18.4.2 itself
    "@types/on-finished": "^2.3.4",
    "typescript": "~4.9.3"                        // core 5.9.0's own TS; do not use the main branch's TS 7 here
  }
}
```

`@adonisjs/logger` needs no explicit dependency — its contract arrives ambiently via `@adonisjs/core`'s typings (core → application → logger@4.1.6, pino ^6.14.0).

## Not verified / open gaps

- **pino-pretty version ceiling for pino 6's `prettyPrint`:** the v5 scaffolder installs `pino-pretty` unpinned; I confirmed `pino-pretty@6.0.0` is the last 6.x on npm and that 7.x targets the pino 7 transport API, but found no authoritative compatibility statement. If the port's docs mention pretty-printing, suggest `pino-pretty@^6` for v5 apps as an inference, not a verified fact.
- **`Server.hooks` has no v5 documentation page** (confirmed absent from the v5-docs guide tree) — all hook behavior above is source-verified against the `v5.12.0` tag only; it is public `ServerContract` API but undocumented, worth noting in the port's README.
- Behavior was verified against `@adonisjs/http-server@5.12.0` (the version `@adonisjs/core@5.9.0` resolves today). Older 5.x http-server versions were not audited; the `^5.9.0` core peer floor keeps the audited surface.
