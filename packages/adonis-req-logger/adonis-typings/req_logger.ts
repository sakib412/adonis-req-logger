declare module '@ioc:Adonis/Addons/ReqLogger' {
  import { HttpContextContract } from '@ioc:Adonis/Core/HttpContext'

  /**
   * Levels a request log line can be written at, least to most severe
   */
  export type RequestLogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'

  /**
   * Resolves the public host a request arrived on, for apps whose proxy
   * chain rewrites the `Host` header before it reaches the application
   * (so `request.hostname()` sees an internal ingress host).
   *
   * Receives the HTTP context and a callback returning the canonicalised
   * default, so an override can fall back without re-implementing it.
   * The returned value is canonicalised like any other, and returning
   * `undefined` omits `request.host` from the record entirely.
   *
   * Synchronous by design: the record is built when the response has
   * already been flushed, and awaiting user code there would let log
   * lines reorder
   */
  export type GetHost = (
    ctx: HttpContextContract,
    resolveDefault: () => string | undefined
  ) => string | undefined

  /**
   * User-facing configuration, lives in `config/req_logger.ts`. All fields
   * are optional, defaults are applied by the provider at boot
   */
  export type ReqLoggerConfig = {
    /**
     * Turn request logging on/off
     *
     * Defaults to `true`
     */
    enabled?: boolean

    /**
     * Base level for request lines that trigger no escalation (no 4xx/5xx
     * status, not slow, no slow queries). Escalations only ever raise the
     * level above this floor. Set it below your logger's level (for
     * example `'debug'` with a logger at `'info'`) to keep routine
     * request lines out of the logs while errors and slow requests still
     * get through
     *
     * Defaults to `'info'`
     */
    level?: RequestLogLevel

    /**
     * Override how `request.host` is resolved. By default the field is
     * the `Host` header, or `X-Forwarded-Host` when the peer is a
     * proxy your `http.trustProxy` setting trusts — correct whenever the
     * public `Host` reaches the application (including behind
     * Cloudflare). Set this when a proxy in front of the app rewrites
     * `Host`, so the default would otherwise see an internal host.
     *
     * Prefer this over widening `http.trustProxy` in `config/app.ts`,
     * which also changes `request.ip()`, `ips()`, `protocol()` and
     * `secure()`
     */
    getHost?: GetHost

    /**
     * Request paths to never log. Strings match the exact path or a path
     * prefix at a segment boundary, regular expressions are tested against
     * the path
     */
    skip?: (string | RegExp)[]

    /**
     * Fraction (0 to 1) of uneventful requests to log. Requests that
     * error, exceed `slowRequestThreshold`, or escalated for a slow query
     * are always logged
     *
     * Defaults to `1`
     */
    sample?: number

    /**
     * Requests taking longer than this many milliseconds are logged at
     * the `warn` level
     *
     * Defaults to `1000`
     */
    slowRequestThreshold?: number

    /**
     * Extra properties merged into every request log record, applied as
     * child-logger bindings on the application logger. Lets aggregators
     * separate request lines from the rest of the application's logs —
     * for example `{ log_type: 'http' }` becomes a Grafana Loki label
     * with pino-loki's `propsToLabels: ['log_type']`. Keep values
     * low-cardinality: static strings, never per-request data
     *
     * Defaults to `{}` (request lines log through the application
     * logger unchanged)
     */
    bindings?: Record<string, string | number | boolean>

    /**
     * Per-request database query stats, collected from Lucid's `db:query`
     * event. Requires `@adonisjs/lucid` with `debug: true` on the
     * connection in `config/database.ts`
     */
    db?: {
      /**
       * Defaults to `true`
       */
      enabled?: boolean

      /**
       * Queries slower than this many milliseconds are itemized inside
       * the log record
       *
       * Defaults to `100`
       */
      slowQueryThreshold?: number

      /**
       * Level the request is logged at when it ran at least one query
       * slower than `slowQueryThreshold`, even if the request itself was
       * fast and successful. The most severe applicable level wins, so a
       * 5xx response still logs at `error`. Values at or below the base
       * `level` opt out of the escalation
       *
       * Defaults to `'warn'`
       */
      slowQueryLevel?: RequestLogLevel

      /**
       * Maximum number of queries captured per request. Counting continues
       * after the cap; ordinary queries stop being captured, slow queries
       * always are
       *
       * Defaults to `50`
       */
      maxQueries?: number
    }
  }
}

declare module '@ioc:Adonis/Addons/ReqLoggerMiddleware' {
  import { HttpContextContract } from '@ioc:Adonis/Core/HttpContext'

  /**
   * Global middleware that scopes the package's AsyncLocalStorage around
   * the request so the `db:query` listener can attribute queries to it.
   * Register in `start/kernel.ts`:
   *
   *   Server.middleware.register([
   *     () => import('@ioc:Adonis/Core/BodyParser'),
   *     () => import('@ioc:Adonis/Addons/ReqLoggerMiddleware'),
   *   ])
   *
   * Only needed for per-request db stats — request lines log without it
   */
  export interface ReqLoggerMiddlewareContract {
    new (...args: any[]): {
      handle(ctx: HttpContextContract, next: () => void): any
    }
  }

  const ReqLoggerMiddleware: ReqLoggerMiddlewareContract
  export default ReqLoggerMiddleware
}
