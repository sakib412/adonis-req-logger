import { hrtimeToMs } from '../log_request'
import { requestStorage } from '../request_store'
import type { ResolvedReqLoggerConfig } from '../types'

/**
 * Shape of Lucid v18's `db:query` event payload (`DbQueryEventNode`),
 * declared structurally so the package works without `@adonisjs/lucid`
 * installed. `duration` is an hrtime tuple. Failed queries also emit,
 * carrying an undeclared `error` field
 */
export type DbQueryEvent = {
  connection: string
  model?: string
  ddl?: boolean
  duration?: [number, number]
  method: string
  sql: string
  bindings?: unknown[]
  inTransaction?: boolean
}

/**
 * Returns a `db:query` listener that attributes queries to the request
 * currently executing. Queries emitted outside a request (boot, ace
 * commands, background jobs) have no store and are ignored
 */
export function createDbQueryListener(config: ResolvedReqLoggerConfig) {
  return function collectQuery(event: DbQueryEvent) {
    const store = requestStorage.getStore()
    if (!store) {
      return
    }

    const durationMs = event.duration ? hrtimeToMs(event.duration) : undefined

    store.queriesCount++
    store.queriesDurationMs += durationMs ?? 0

    /**
     * Past the cap, ordinary queries are only counted. Slow queries are
     * still captured — they are the signal: they must itemize, escalate
     * the level, and exempt the request from sampling
     */
    if (store.queries.length >= config.db.maxQueries) {
      store.queriesTruncated = true
      if (durationMs === undefined || durationMs < config.db.slowQueryThreshold) {
        return
      }
    }

    /**
     * Bindings are intentionally never captured — they carry user data
     */
    store.queries.push({
      sql: event.sql,
      durationMs,
      model: event.model,
      connection: event.connection,
      method: event.method,
      inTransaction: event.inTransaction ?? false,
    })
  }
}
