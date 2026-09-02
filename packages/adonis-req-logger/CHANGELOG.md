# Changelog

All notable changes to the 5.x line of `adonis-req-logger` are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow the
[versioning policy](https://github.com/sakib412/adonis-req-logger/blob/main/docs/ARCHITECTURE.md#versioning--support-policy)
(the major tracks the AdonisJS major). The 7.x line keeps its own changelog on
`main`.

## [Unreleased]

## [5.2.0] - 2026-09-02

### Added

- `request.host` in the canonical record: the domain the client asked for,
  canonicalized (first comma-separated entry, port stripped, lowercased, one
  trailing dot removed, capped at 253 characters) and omitted when nothing
  resolves. Never emitted as a top-level `hostname`, which `pino-loki` reserves
  for the machine label. Back-ported from 7.1.0.
- The default host is trust-aware: `Host`, or `X-Forwarded-Host` when the
  peer is a proxy the app's `http.trustProxy` trusts. It deliberately does not
  go through `request.hostname()`: `@adonisjs/http-server` 5.12.0 inverts that
  check in `Request.host()`, honouring the header from untrusted peers and
  ignoring it from trusted ones, which would let any client spoof the field.
- `getHost(ctx, resolveDefault)` config option: a synchronous resolution
  override for deployments whose proxy chain rewrites `Host`. Its result is
  canonicalized like the default; returning `undefined` omits the field; a
  throw omits the field, is reported once, and never costs the log line. The
  `GetHost` type is exported from `@ioc:Adonis/Addons/ReqLogger`.
- README guidance for `Host`-rewriting proxies, for `request.ip` behind
  Cloudflare, and a Loki query recipe for the new field.

### Changed

- `instructions.md` and the README now register `ReqLoggerMiddleware` **first**
  in the global middleware list, so `db.count` covers every query the request
  caused. Existing installs are untouched; moving the line yourself raises
  `db.count` accordingly.
- The provider rejects a non-function `getHost` at boot.

## [5.1.0] - 2026-07-14

### Added

- `bindings` option: request lines emit through a child logger carrying the
  given properties (for example `log_type: 'http'` for pino-loki's
  `propsToLabels`), so aggregators can split request lines from application
  logs. v5's stand-in for the 7.x named `logger` knob.

## [5.0.0] - 2026-07-14

First release of the AdonisJS v5 support line, published under the npm
`adonis5` dist-tag. A full port of the 7.x design onto v5 APIs: one canonical
line per request timed from a server before-hook to response flush
(`on-finished`), per-request Lucid v18 query stats via `db:query`, level
escalation, skip lists and sampling. See the
[GitHub release](https://github.com/sakib412/adonis-req-logger/releases/tag/v5.0.0).

[Unreleased]: https://github.com/sakib412/adonis-req-logger/compare/v5.2.0...v5.x
[5.2.0]: https://github.com/sakib412/adonis-req-logger/compare/v5.1.0...v5.2.0
[5.1.0]: https://github.com/sakib412/adonis-req-logger/compare/v5.0.0...v5.1.0
[5.0.0]: https://github.com/sakib412/adonis-req-logger/releases/tag/v5.0.0
