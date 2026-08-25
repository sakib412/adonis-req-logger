/*
|--------------------------------------------------------------------------
| Pretty transport target
|--------------------------------------------------------------------------
|
| A pino-pretty preset for request logs during development. Renders the
| request summary line with the request's host and the per-request query
| stats appended as " · " segments:
|
|   [13:09:17.033] INFO: POST /api/v1/auth/signup 200 63ms · shop.example.com · 3 queries 1.8ms
|
| The host is shown whenever the record has one, "localhost" included: a
| segment that only appears for unusual hosts is one nobody notices is
| missing when host resolution breaks.
|
| Usage in "config/logger.ts":
|
|   targets().pushIf(!app.inProduction, { target: 'adonis-req-logger/pretty' })
|
| Being a wrapper module (instead of pino-pretty options in the config)
| lets it use a messageFormat function — transport options must cross a
| worker-thread boundary and cannot hold functions. Requires "pino-pretty"
| to be installed (it ships with AdonisJS starter kits in development).
|
*/

import string from '@adonisjs/core/helpers/string'
import pinoPretty, { type PrettyOptions } from 'pino-pretty'

type RequestLogRecord = {
  [key: string]: unknown
  request?: {
    host?: string
  }
  db?: {
    count?: number
    duration_ms?: number
  }
}

/**
 * Longest host rendered in the terminal. The record caps the host at 253
 * characters (the maximum length of a DNS name), which is right for the
 * record but fills a one-line terminal format — so display gets its own,
 * much shorter budget. 32 spares every realistic host
 * ("pr123-restaurant.ezysites.com" is 29) and only ever truncates the
 * hostile input the record's cap exists for
 */
const MAX_HOST_DISPLAY_LENGTH = 32

export default function prettyTarget(options: PrettyOptions = {}) {
  return pinoPretty({
    translateTime: 'SYS:HH:MM:ss.l',
    ignore: 'pid,hostname,name,request,response,db,duration_ms',
    ...options,
    /**
     * Only the two documented parameters are declared on purpose: pino-pretty
     * calls `messageFormat` with further positional arguments, so a defaulted
     * third parameter would be silently overwritten
     */
    messageFormat: (log: RequestLogRecord, messageKey: string) => {
      const segments = [String(log[messageKey] ?? '')]

      /**
       * Identity before metrics, and the query stats stay last so a reader
       * already used to this format finds them where they always were
       */
      const host = log.request?.host
      if (typeof host === 'string' && host !== '') {
        segments.push(
          host.length > MAX_HOST_DISPLAY_LENGTH
            ? `${host.slice(0, MAX_HOST_DISPLAY_LENGTH - 1)}…`
            : host
        )
      }

      const db = log.db
      if (db && typeof db.count === 'number' && db.count > 0) {
        segments.push(`${db.count} ${string.pluralize('query', db.count)} ${db.duration_ms}ms`)
      }

      return segments.join(' · ')
    },
  })
}
