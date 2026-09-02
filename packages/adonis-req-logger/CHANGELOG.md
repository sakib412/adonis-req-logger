# Changelog

All notable changes to the 7.x line of `adonis-req-logger` are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow the
[versioning policy](../../docs/ARCHITECTURE.md#versioning--support-policy)
(the major tracks the AdonisJS major). The 5.x line keeps its own changelog on
the `v5.x` branch.

## [Unreleased]

## [7.1.0] - 2026-09-02

### Added

- `request.host` in the canonical record: the domain the client asked for,
  canonicalized (first comma-separated entry, port stripped, lowercased, one
  trailing dot removed, capped at 253 characters) and omitted when nothing
  resolves. Never emitted as a top-level `hostname`, which `pino-loki` reserves
  for the machine label.
- `getHost(ctx, resolveDefault)` config option: a synchronous resolution
  override for deployments whose proxy chain rewrites `Host`. Its result is
  canonicalized like the default; returning `undefined` omits the field; a
  throw omits the field, is reported once, and never costs the log line. The
  `GetHost` type is exported.
- The development pretty preset renders the host as its own trailing segment,
  capped at 32 characters for display.
- README guidance for `Host`-rewriting proxies, for `request.ip` behind
  Cloudflare, and a Loki query recipe for the new field.

### Changed

- `node ace add adonis-req-logger` registers the middleware **first** among
  server middleware, so `db.count` covers every query the request caused.
  Existing installs are untouched; moving the line yourself raises `db.count`
  accordingly.
- `defineConfig` rejects a non-function `getHost` at boot.

## [7.0.0] - 2026-07-14

First release for AdonisJS v7, published as npm `latest`. See the
[GitHub release](https://github.com/sakib412/adonis-req-logger/releases/tag/v7.0.0).

[Unreleased]: https://github.com/sakib412/adonis-req-logger/compare/v7.1.0...HEAD
[7.1.0]: https://github.com/sakib412/adonis-req-logger/compare/v7.0.0...v7.1.0
[7.0.0]: https://github.com/sakib412/adonis-req-logger/releases/tag/v7.0.0
