import type { LoggersList } from '@adonisjs/core/types'

import type { RequestLogLevel } from './levels.js'

export type { RequestLogLevel } from './levels.js'

/**
 * User-facing configuration for the request logger. All fields are
 * optional, defaults are applied by `defineConfig`
 */
export type ReqLoggerConfig = {
  /**
   * Turn request logging on/off
   *
   * Defaults to `true`
   */
  enabled?: boolean

  /**
   * Name of the logger (from `config/logger.ts`) used to write request
   * logs — type-checked against the loggers your application declares
   * on the `LoggersList` interface. Defaults to the application default
   * logger
   */
  logger?: keyof LoggersList

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
   * Requests taking longer than this are logged at the `warn` level.
   * Milliseconds, or a duration expression like `'1 second'`
   *
   * Defaults to `1000`
   */
  slowRequestThreshold?: number | string

  /**
   * Per-request database query stats, collected from Lucid's `db:query`
   * event. Requires `@adonisjs/lucid` with `debug: true` on the connection
   */
  db?: {
    /**
     * Defaults to `true`
     */
    enabled?: boolean

    /**
     * Queries slower than this are itemized inside the log record.
     * Milliseconds, or a duration expression like `'100 ms'`
     *
     * Defaults to `100`
     */
    slowQueryThreshold?: number | string

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

/**
 * Configuration after `defineConfig` has applied defaults
 */
export type ResolvedReqLoggerConfig = {
  enabled: boolean
  logger?: keyof LoggersList
  level: RequestLogLevel
  skip: (string | RegExp)[]
  sample: number
  slowRequestThreshold: number
  db: {
    enabled: boolean
    slowQueryThreshold: number
    slowQueryLevel: RequestLogLevel
    maxQueries: number
  }
}

/**
 * A database query captured while a request was executing
 */
export type CapturedQuery = {
  sql: string
  durationMs?: number
  model?: string
  connection: string
  method: string
  inTransaction: boolean
}

/**
 * Mutable per-request state. Created by the middleware, filled by
 * collectors, and read when the request completes
 */
export type RequestStore = {
  queriesCount: number
  queriesDurationMs: number
  queries: CapturedQuery[]
  queriesTruncated: boolean
}
