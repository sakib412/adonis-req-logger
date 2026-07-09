/*
|--------------------------------------------------------------------------
| Pretty transport target
|--------------------------------------------------------------------------
|
| A pino-pretty preset for request logs during development. Renders the
| request summary line with the per-request query stats appended:
|
|   [13:09:17.033] INFO: POST /api/v1/auth/signup 200 63ms · 3 queries 1.8ms
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
  db?: {
    count?: number
    duration_ms?: number
  }
}

export default function prettyTarget(options: PrettyOptions = {}) {
  return pinoPretty({
    translateTime: 'SYS:HH:MM:ss.l',
    ignore: 'pid,hostname,name,request,response,db,duration_ms',
    ...options,
    messageFormat: (log: RequestLogRecord, messageKey: string) => {
      const message = String(log[messageKey] ?? '')
      const db = log.db

      if (db && typeof db.count === 'number' && db.count > 0) {
        return `${message} · ${db.count} ${string.pluralize('query', db.count)} ${db.duration_ms}ms`
      }

      return message
    },
  })
}
