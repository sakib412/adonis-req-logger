import type { HttpContextContract } from '@ioc:Adonis/Core/HttpContext'
import type { LoggerContract } from '@ioc:Adonis/Core/Logger'

import { storeByContext } from './request_store'
import { mostSevere, severity } from './levels'
import type { CapturedQuery, RequestStore, ResolvedReqLoggerConfig } from './types'

/**
 * Longest SQL text itemized for a slow query before truncation
 */
const MAX_SQL_LENGTH = 1000

export function hrtimeToMs(duration: [number, number]): number {
  return duration[0] * 1000 + duration[1] / 1e6
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}

function toNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function truncateSql(sql: string): string {
  return sql.length <= MAX_SQL_LENGTH ? sql : `${sql.slice(0, MAX_SQL_LENGTH)}…`
}

export function shouldSkip(path: string, patterns: (string | RegExp)[]): boolean {
  return patterns.some((pattern) => {
    if (typeof pattern === 'string') {
      return path === pattern || path.startsWith(pattern.endsWith('/') ? pattern : `${pattern}/`)
    }
    return pattern.test(path)
  })
}

/**
 * Builds the canonical log record for a completed request and writes it
 * through the given logger. Invoked from the on-finished callback, after
 * the response has been flushed to the socket
 */
export function logRequest(
  ctx: HttpContextContract,
  duration: [number, number],
  config: ResolvedReqLoggerConfig,
  logger: LoggerContract
) {
  const path = ctx.request.url()
  if (shouldSkip(path, config.skip)) {
    return
  }

  const status = ctx.response.getStatus()
  const durationMs = round(hrtimeToMs(duration))

  const store = config.db.enabled ? storeByContext.get(ctx) : undefined
  const slowQueries = store ? findSlowQueries(store, config) : []

  /**
   * `config.level` is a floor: escalations only ever raise the level
   * above it. Slow queries escalate only when `slowQueryLevel` sits
   * above the floor, which is also the opt-out
   */
  let level = config.level
  let eventful = false

  if (status >= 500) {
    level = mostSevere(level, 'error')
    eventful = true
  } else if (status >= 400) {
    level = mostSevere(level, 'warn')
    eventful = true
  }

  if (durationMs >= config.slowRequestThreshold) {
    level = mostSevere(level, 'warn')
    eventful = true
  }

  if (slowQueries.length && severity(config.db.slowQueryLevel) > severity(config.level)) {
    level = mostSevere(level, config.db.slowQueryLevel)
    eventful = true
  }

  /**
   * Sampling only ever drops uneventful requests. Errors, slow
   * requests, and slow queries are always logged
   */
  if (!eventful && config.sample < 1 && Math.random() >= config.sample) {
    return
  }

  const method = ctx.request.method()
  const record: Record<string, unknown> = {
    request: {
      id: ctx.request.id(),
      method,
      url: ctx.request.url(true),
      route: ctx.route ? ctx.route.pattern : undefined,
      ip: ctx.request.ip(),
      user_agent: ctx.request.header('user-agent'),
      content_length: toNumber(ctx.request.header('content-length')),
    },
    response: {
      status,
      content_length: toNumber(ctx.response.getHeader('content-length')),
    },
    duration_ms: durationMs,
  }

  if (store) {
    record.db = buildDbStats(store, slowQueries)
  }

  logger[level](record, `${method} ${path} ${status} ${Math.round(durationMs)}ms`)
}

function findSlowQueries(store: RequestStore, config: ResolvedReqLoggerConfig): CapturedQuery[] {
  return store.queries.filter(
    (query) => query.durationMs !== undefined && query.durationMs >= config.db.slowQueryThreshold
  )
}

function buildDbStats(store: RequestStore, slow: CapturedQuery[]) {
  const stats: Record<string, unknown> = {
    count: store.queriesCount,
    duration_ms: round(store.queriesDurationMs),
  }

  if (slow.length) {
    stats.slow = slow.map((query) => ({
      sql: truncateSql(query.sql),
      duration_ms: round(query.durationMs!),
      model: query.model,
    }))
  }

  if (store.queriesTruncated) {
    stats.truncated = true
  }

  return stats
}
