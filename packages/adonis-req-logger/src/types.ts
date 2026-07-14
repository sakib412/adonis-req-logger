import type { ReqLoggerConfig, RequestLogLevel } from '@ioc:Adonis/Addons/ReqLogger'

export type { ReqLoggerConfig, RequestLogLevel }

/**
 * Configuration after the provider has applied defaults
 */
export type ResolvedReqLoggerConfig = {
  enabled: boolean
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
 * Mutable per-request state. Created when the request starts, filled by
 * collectors, and read when the request completes
 */
export type RequestStore = {
  queriesCount: number
  queriesDurationMs: number
  queries: CapturedQuery[]
  queriesTruncated: boolean
}
