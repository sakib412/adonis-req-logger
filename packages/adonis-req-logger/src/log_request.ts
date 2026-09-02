import type { HttpContextContract } from '@ioc:Adonis/Core/HttpContext'
import type { LoggerContract } from '@ioc:Adonis/Core/Logger'

import { storeByContext } from './request_store'
import { mostSevere, severity } from './levels'
import type { CapturedQuery, RequestStore, ResolvedReqLoggerConfig, TrustProxy } from './types'

/**
 * Longest SQL text itemized for a slow query before truncation
 */
const MAX_SQL_LENGTH = 1000

/**
 * Longest host recorded before truncation. 253 is the maximum length of
 * a DNS fully-qualified domain name, so no legitimate host is affected —
 * the cap exists because `Host` is attacker-controlled and an unbounded
 * field on every line is a log-bloat vector
 */
const MAX_HOST_LENGTH = 253

/**
 * Generous pre-slice applied before canonicalizing, so a hostile
 * multi-kilobyte header is not lowercased in full on the hot path
 */
const HOST_SCAN_LIMIT = 512

/**
 * A `getHost` that throws is a bug that would repeat on every request,
 * so it is reported once per process
 */
let getHostErrorReported = false

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

/**
 * Canonicalizes a host value for the record: the *syntax* is normalized,
 * the *meaning* is never interpreted. Case and the FQDN root dot are
 * folded, because they make one name look like several to a log query;
 * a deploy-stage prefix or tenant subdomain is left exactly as it
 * arrived, because collapsing those is the consumer's decision.
 *
 * Returns `undefined` when nothing usable is left, which omits the key
 */
export function canonicalizeHost(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined
  }

  /**
   * A multi-proxy chain can send "a.com, b.com" (the framework never
   * splits it). The leftmost entry is the one closest to the client,
   * matching the X-Forwarded-For convention
   */
  const host = value.slice(0, HOST_SCAN_LIMIT).split(',')[0].trim()
  if (!host) {
    return undefined
  }

  /**
   * Strip the port, starting the search after a bracketed IPv6 literal
   * so "[2001:db8::1]:443" keeps its address. Must happen before the
   * trailing dot is trimmed — in "example.com.:8080" the dot is not
   * trailing until the port is gone
   */
  const offset = host[0] === '[' ? host.indexOf(']') + 1 : 0
  const portAt = host.indexOf(':', offset)
  const canonical = (portAt === -1 ? host : host.slice(0, portAt)).toLowerCase().replace(/\.$/, '')

  if (!canonical) {
    return undefined
  }

  /**
   * A plain slice: the value is an attacker-controlled token, not prose
   */
  return canonical.length > MAX_HOST_LENGTH
    ? `${canonical.slice(0, MAX_HOST_LENGTH - 1)}…`
    : canonical
}

/**
 * Mirrors the framework's own "is this peer a trusted proxy" check
 * (`trustProxy(remoteAddress, 0)`) on the app's configured predicate
 */
function isTrustedProxy(remoteAddress: string | undefined, trustProxy: TrustProxy): boolean {
  return remoteAddress !== undefined && trustProxy(remoteAddress, 0)
}

/**
 * The host the client asked for, before canonicalization: `Host`, or
 * `X-Forwarded-Host` when the peer is a proxy the app trusts.
 *
 * Deliberately not `ctx.request.hostname()`. In AdonisJS v5
 * (`@adonisjs/http-server` 5.12.0, `Request.host()`) the trust check is
 * inverted — X-Forwarded-Host is honoured from *untrusted* peers and
 * ignored from trusted ones — so on that API any client could spoof the
 * logged host, and a trusted proxy that sets the header would be
 * ignored. This is the check as documented, applied to the same
 * `http.trustProxy` setting the app already configures
 */
function defaultHost(ctx: HttpContextContract, trustProxy: TrustProxy): string | undefined {
  const forwarded = ctx.request.header('x-forwarded-host')
  if (forwarded && isTrustedProxy(ctx.request.request.socket.remoteAddress, trustProxy)) {
    return forwarded
  }
  return ctx.request.header('host')
}

/**
 * Resolves `request.host`, using the trust-aware default unless the app
 * supplies a `getHost` override. The override's result is canonicalized
 * the same way, so the field's shape never depends on whether one is
 * configured
 */
function resolveHost(
  ctx: HttpContextContract,
  config: ResolvedReqLoggerConfig,
  logger: LoggerContract
): string | undefined {
  const resolveDefault = () => canonicalizeHost(defaultHost(ctx, config.trustProxy))

  if (!config.getHost) {
    return resolveDefault()
  }

  try {
    return canonicalizeHost(config.getHost(ctx, resolveDefault))
  } catch (error) {
    /**
     * The record is built after the response has been flushed, so an
     * escaping error would cost the entire log line. Drop the field, keep
     * the line
     */
    if (!getHostErrorReported) {
      getHostErrorReported = true
      logger.error(
        { err: error },
        'adonis-req-logger: "getHost" threw, so "request.host" is omitted from request logs'
      )
    }
    return undefined
  }
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
      host: resolveHost(ctx, config, logger),
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
