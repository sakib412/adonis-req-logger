import string from '@adonisjs/core/helpers/string'
import type { HttpContext } from '@adonisjs/core/http'
import type { Logger } from '@adonisjs/core/logger'

import { storeByContext } from './request_store.js'
import { mostSevere, severity } from './levels.js'
import type { CapturedQuery, RequestStore, ResolvedReqLoggerConfig } from './types.js'

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
 * through the given logger. Invoked from the `http:request_completed`
 * listener, after the response has been flushed
 */
export function logRequest(
  ctx: HttpContext,
  duration: [number, number],
  config: ResolvedReqLoggerConfig,
  logger: Logger
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
      route: ctx.route?.pattern,
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
      sql: string.truncate(query.sql, MAX_SQL_LENGTH, { completeWords: false, suffix: '…' }),
      duration_ms: round(query.durationMs!),
      model: query.model,
    }))
  }

  if (store.queriesTruncated) {
    stats.truncated = true
  }

  return stats
}
