# Contributing to adonis-req-logger

Thanks for your interest in contributing! This document covers how the repo is
laid out, how to get a working dev environment, and what we expect from
changes.

## Prerequisites

- **Node.js >= 24** (the floor set by AdonisJS v7 itself)
- **pnpm 11** — `corepack enable` will pick up the version pinned in the root
  `package.json`

## Repo layout

This is a pnpm workspace:

| Path                         | What it is                                                          |
| ---------------------------- | ------------------------------------------------------------------- |
| `packages/adonis-req-logger` | The published package                                               |
| `apps/backend`               | An AdonisJS example app that consumes the package — the dev testbed |
| `docs/ARCHITECTURE.md`       | The design document — **read this first**                           |

## Setup

```sh
pnpm install
pnpm --filter adonis-req-logger build
```

## Development workflow

Build, typecheck, and format the package:

```sh
pnpm --filter adonis-req-logger build      # tsc → build/ + copies stubs
pnpm --filter adonis-req-logger typecheck  # tsc --noEmit
pnpm --filter adonis-req-logger format     # prettier
```

The backend app consumes the package's **built output**, so rebuild the
package after changing its source, then exercise it for real:

```sh
cd apps/backend
node ace serve
```

Demo routes that exercise the logger:

- `GET /demo/users` — single query
- `GET /demo/n-plus-one` — classic N+1 pattern
- `GET /demo/slow-query` — a deliberately slow query that trips
  `slowQueryThreshold` and escalates the log level

Watch the terminal: every request should produce one summary line, with query
stats appended (`· 3 queries 1.8ms`).

## Design constraints

`docs/ARCHITECTURE.md` opens with **locked decisions** — one canonical log
line per request, no storage/UI/delivery-transport code, safe-by-default
field capture, own `AsyncLocalStorage`. Proposals that conflict with a locked
decision need to argue for changing the decision in the design doc, not just
ship code around it.

A few conventions the package follows:

- ESM-only, `snake_case` file names, built with plain `tsc`
- Prefer AdonisJS ecosystem helpers (`@adonisjs/core/helpers`) over
  hand-rolled utilities where an equivalent exists
- `@adonisjs/lucid` and `pino-pretty` must remain **optional** peers — the
  package has to work in apps that have neither

## Version branches

The package major tracks the AdonisJS major it supports (see the
[versioning policy](docs/ARCHITECTURE.md#versioning--support-policy)):

- `main` — newest AdonisJS major (currently v7 → package `7.x`, npm `latest`)
- `v5.x` — legacy AdonisJS v5 line (package `5.x`, npm tag `adonis5`)

Target your PR at the branch matching the AdonisJS major it concerns; fixes
that apply to several lines land on `main` first and are back-ported.

## Commits and pull requests

- Follow [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:`, `chore:`…) — the existing history is the example
- Keep PRs focused; update `README.md` / `docs/ARCHITECTURE.md` alongside
  behavior changes so code and docs never diverge
- Make sure `build` and `typecheck` pass for the package and that the example
  backend still boots and logs

## Reporting bugs

Open an issue at
[github.com/sakib412/adonis-req-logger/issues](https://github.com/sakib412/adonis-req-logger/issues)
with the AdonisJS and package versions, your `config/req_logger.ts`, and a
minimal reproduction if possible.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By
participating you agree to uphold it.
