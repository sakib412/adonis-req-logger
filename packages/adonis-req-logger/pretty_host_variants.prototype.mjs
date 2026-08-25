/*
|--------------------------------------------------------------------------
| THROWAWAY PROTOTYPE — do not ship, do not import
|--------------------------------------------------------------------------
|
| Question (issue #33): should "pretty.ts" render request.host in the dev
| terminal one-liner, and how, without bloating the line for single-domain
| apps (the majority)?
|
| Four structurally different candidates, rendered through the REAL
| pino-pretty with the REAL preset options, against realistic records —
| including the db-stats suffix that already competes for the same space.
|
|   run:  node packages/adonis-req-logger/pretty_host_variants.prototype.mjs
|
| Variant 0  none        today's behaviour — the anchor
| Variant A  suffix      host as a " · " segment, before the db segment
| Variant B  authority   host spliced into the path, so the line reads as a URL
| Variant C  conditional shown only when it differs from the first host seen
| Variant D  opt-in      variant A, but off unless the preset is passed a flag
|
| Note for D: pino-pretty transport options cross a worker-thread boundary,
| so they cannot hold functions — but a boolean serialises fine, and
| prettyTarget(options) already merges caller options. So an opt-in flag is
| genuinely available, unlike a user-supplied formatter.
|
*/

import { prettyFactory } from 'pino-pretty'

const plural = (n) => (n === 1 ? 'query' : 'queries')

/**
 * Display-only cap. The record's 253-char cap is right for the record but
 * unreadable in a one-line terminal format, so the terminal needs its own,
 * much shorter budget. Keeps the head (the interesting part of a hostile
 * host, and the tenant of a real one) — see the "display cap" matrix below
 */
const DISPLAY_MAX = 32
const fit = (host) => (host.length > DISPLAY_MAX ? `${host.slice(0, DISPLAY_MAX - 1)}…` : host)

/**
 * The db segment exactly as pretty.ts renders it today
 */
function dbSuffix(log) {
  const db = log.db
  if (db && typeof db.count === 'number' && db.count > 0) {
    return ` · ${db.count} ${plural(db.count)} ${db.duration_ms}ms`
  }
  return ''
}

/**
 * Variant 0 — today
 */
const none = (log, key) => `${String(log[key] ?? '')}${dbSuffix(log)}`

/**
 * Variant A — host as its own " · " segment, ahead of the db stats
 */
const makeSuffix = (cap) => (log, key) => {
  const host = log.request?.host
  const hostPart = host ? ` · ${cap(host)}` : ''
  return `${String(log[key] ?? '')}${hostPart}${dbSuffix(log)}`
}
const suffix = makeSuffix((h) => h)

/**
 * Variant B — splice the host in front of the path so the line reads as a
 * URL. msg is fixed as "<METHOD> <path> <status> <ms>ms"
 */
const authority = (log, key) => {
  const message = String(log[key] ?? '')
  const host = log.request?.host
  if (!host) return `${message}${dbSuffix(log)}`
  const [method, path, ...rest] = message.split(' ')
  return `${method} ${host}${path} ${rest.join(' ')}${dbSuffix(log)}`
}

/**
 * Variant C — only render the host once it carries information: the first
 * host seen becomes the baseline and is suppressed thereafter
 */
let baseline
const conditional = (log, key) => {
  const message = String(log[key] ?? '')
  const host = log.request?.host
  if (host && baseline === undefined) baseline = host
  const interesting = host && host !== baseline
  return `${message}${interesting ? ` · @${host}` : ''}${dbSuffix(log)}`
}

/**
 * Variant D — variant A behind a flag the preset would accept
 */
const optIn = (showHost) => (log, key) => (showHost ? suffix(log, key) : none(log, key))

const VARIANTS = [
  ['0  none       (today)', none],
  ['A  suffix', suffix],
  ['B  authority', authority],
  ['C  conditional', conditional],
  ['D  opt-in     (flag off)', optIn(false)],
  ['D  opt-in     (flag on)', optIn(true)],
]

const AT = Date.parse('2026-08-25T13:09:17.033Z')
const base = { pid: 4242, hostname: 'ecs-container-7f3a', name: 'http' }

const SCENARIOS = [
  ['single-domain dev, no queries', 30, 'localhost', 'GET / 200 3ms', { count: 0, duration_ms: 0 }],
  ['single-domain dev, with queries', 30, 'localhost', 'POST /api/v1/auth/signup 200 63ms', { count: 3, duration_ms: 1.8 }],
  ['multi-tenant production', 30, 'shop.example.com', 'GET /api/v1/products 200 41ms', { count: 5, duration_ms: 12.3 }],
  ['long tenant / PR deploy', 30, 'pr123-restaurant.ezysites.com', 'GET /api/v1/menu 200 88ms', { count: 2, duration_ms: 3.1 }],
  ['host absent (HTTP/1.0, scanner)', 30, undefined, 'GET / 200 2ms', { count: 0, duration_ms: 0 }],
  ['hostile host, truncated at 253', 30, 'a'.repeat(252) + '…', 'GET / 404 1ms', { count: 0, duration_ms: 0 }],
  ['error line, multi-tenant', 50, 'shop.example.com', 'GET /api/v1/orders/9 500 210ms', { count: 1, duration_ms: 0.9 }],
  ['IPv6 literal host', 30, '[2001:db8::1]', 'GET /health 200 1ms', { count: 0, duration_ms: 0 }],
]

function record(level, host, msg, db) {
  const request = { id: 'b04ce2db', method: msg.split(' ')[0], url: msg.split(' ')[1], route: '/', ip: '203.0.113.7' }
  if (host !== undefined) request.host = host
  return { ...base, level, time: AT, request, response: { status: 200 }, duration_ms: 1, db, msg }
}

for (const [label, messageFormat] of VARIANTS) {
  const pretty = prettyFactory({
    translateTime: 'SYS:HH:MM:ss.l',
    ignore: 'pid,hostname,name,request,response,db,duration_ms',
    colorize: true,
    messageFormat,
  })
  baseline = undefined
  console.log(`\n\x1b[1m\x1b[7m  VARIANT ${label}  \x1b[0m`)
  for (const [name, level, host, msg, db] of SCENARIOS) {
    const line = pretty(JSON.stringify(record(level, host, msg, db))).trimEnd()
    console.log(`  \x1b[2m${name.padEnd(32)}\x1b[0m ${line}`)
  }
}
console.log()

/*
| Second matrix: the same candidates with the display cap applied, on just
| the rows where host length is the deciding factor.
*/
const capped = {
  'A  suffix   + display cap': makeSuffix(fit),
  'B  authority+ display cap': (log, key) => {
    const message = String(log[key] ?? '')
    const host = log.request?.host
    if (!host) return `${message}${dbSuffix(log)}`
    const [method, path, ...rest] = message.split(' ')
    return `${method} ${fit(host)}${path} ${rest.join(' ')}${dbSuffix(log)}`
  },
}

const LENGTH_ROWS = SCENARIOS.filter(([n]) =>
  n.includes('long tenant') || n.includes('hostile') || n.includes('multi-tenant production') || n.includes('IPv6')
)

console.log('\x1b[1m\x1b[7m  DISPLAY CAP (32 chars) — length-sensitive rows only  \x1b[0m')
for (const [label, messageFormat] of Object.entries(capped)) {
  const pretty = prettyFactory({
    translateTime: 'SYS:HH:MM:ss.l',
    ignore: 'pid,hostname,name,request,response,db,duration_ms',
    colorize: true,
    messageFormat,
  })
  console.log(`\n\x1b[1m  ${label}\x1b[0m`)
  for (const [name, level, host, msg, db] of LENGTH_ROWS) {
    const line = pretty(JSON.stringify(record(level, host, msg, db))).trimEnd()
    console.log(`  \x1b[2m${name.padEnd(32)}\x1b[0m ${line}`)
  }
}
console.log()
