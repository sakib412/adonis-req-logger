import type { RequestLogLevel } from '@ioc:Adonis/Addons/ReqLogger'

/**
 * Levels a request log line can be written at, ordered least to most
 * severe — the array index is the severity rank
 */
export const REQUEST_LOG_LEVELS: RequestLogLevel[] = [
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
]

export function severity(level: RequestLogLevel): number {
  return REQUEST_LOG_LEVELS.indexOf(level)
}

export function mostSevere(a: RequestLogLevel, b: RequestLogLevel): RequestLogLevel {
  return severity(b) > severity(a) ? b : a
}
