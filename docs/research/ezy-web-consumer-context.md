# ezy-web consumer context — `community-api` + `adonis-req-logger`

Read-only investigation of `/Users/appifylab/gh/AppifyLab/ezy-web` (pnpm/turbo monorepo).
Nothing in ezy-web was modified. All paths below are absolute.
`.claude/worktrees/*` copies were ignored throughout (they are stale duplicates of `apps/`).

Consumer: `apps/community-api` (AdonisJS 6), depends on `"adonis-req-logger": "^7.0.0"`
(`/Users/appifylab/gh/AppifyLab/ezy-web/apps/community-api/package.json:88`).

---

## 1. req_logger + logger config

### 1.1 `config/req_logger.ts` (full contents)

`/Users/appifylab/gh/AppifyLab/ezy-web/apps/community-api/config/req_logger.ts:1-59`

```ts
import {defineConfig} from 'adonis-req-logger';

import env from '#start/env';
import {apiPrefix} from '#utils/index';

const reqLoggerConfig = defineConfig({
  /**
   * Turn request logging on/off without a deploy.
   */
  enabled: env.get('REQ_LOGGER_ENABLED', true),

  /**
   * Named logger (from "config/logger.ts") to write request logs
   * through. Remove to use the default logger.
   */
  logger: 'http',

  /**
   * Base level for requests that trigger no escalation. Errors, slow
   * requests, and slow queries always log above this floor.
   */
  level: 'info',

  /**
   * Paths that never get logged. Strings match the exact path or a
   * path prefix, regular expressions are tested against the path.
   * The unsubscribe GET carries a capability token in its query string
   * and the logger records the full url — skip it so the token never
   * lands in the logs. Routes mount under apiPrefix, so build the skip
   * paths from the same value.
   */
  skip: [`${apiPrefix}/health`, `${apiPrefix}/internal/email/unsubscribe`],

  /**
   * Fraction (0 to 1) of successful requests to log. Errors and slow
   * requests are always logged.
   */
  sample: 1,

  /**
   * Requests slower than this many milliseconds are logged at "warn".
   */
  slowRequestThreshold: 1000,

  /**
   * Per-request database query stats. Lucid only emits query events when
   * the connection has "debug: true" (config/database.ts ties that to
   * DB_DEBUG), so follow the same flag — with it off the stats would be
   * misleading zeros plus a boot warning.
   */
  db: {
    enabled: env.get('DB_DEBUG', false),
    slowQueryThreshold: 1000,
    slowQueryLevel: 'warn',
    maxQueries: 50,
  },
});

export default reqLoggerConfig;
```

`apiPrefix` = `env.get('API_PREFIX', '/api')`
(`/Users/appifylab/gh/AppifyLab/ezy-web/apps/community-api/utils/index.ts:10`).

### 1.2 `config/logger.ts` (full contents)

`/Users/appifylab/gh/AppifyLab/ezy-web/apps/community-api/config/logger.ts:1-100`

```ts
import type {LokiOptions} from 'pino-loki';

import {defineConfig, targets} from '@adonisjs/core/logger';
import app from '@adonisjs/core/services/app';

import env from '#start/env';
import {getAppEnv} from '#utils/constants/index';

// pino-loki appends the push path (/loki/api/v1/push) to `host` itself, so
// LOKI_HOST must be the BASE url only (e.g. https://<stack>.grafana.net).
const lokiHost = env.get('LOKI_HOST');
const lokiUser = env.get('LOKI_USER');
const lokiPassword = env.get('LOKI_PASSWORD')?.release();
const lokiOrgId = env.get('LOKI_ORG_ID');

const lokiTarget = (logType: 'app' | 'http') =>
  lokiHost
    ? {
        target: 'pino-loki',
        level: env.get('LOG_LEVEL'),
        options: {
          host: lokiHost,
          labels: {
            log_type: logType,
            app: env.get('APP_NAME', 'community-api'),
            env: app.inProduction ? 'production' : 'development',
            app_env: getAppEnv(),
          },
          batching: {interval: 5}, // 5s batches — non-blocking
          ...(lokiUser && lokiPassword
            ? {basicAuth: {username: lokiUser, password: lokiPassword}}
            : {}),
          ...(lokiOrgId ? {headers: {'X-Scope-OrgID': lokiOrgId}} : {}),
        } satisfies LokiOptions,
      }
    : null;

const appLokiTarget = lokiTarget('app');
const httpLokiTarget = lokiTarget('http');

const loggerConfig = defineConfig({
  default: 'app',
  loggers: {
    app: {
      enabled: true,
      name: env.get('APP_NAME'),
      level: env.get('LOG_LEVEL'),
      transport: {
        targets: targets()
          .pushIf(!app.inProduction, targets.pretty())
          // .pushIf(app.inProduction, targets.file({destination: 1}))
          .pushIf(appLokiTarget !== null, appLokiTarget!)
          .toArray(),
      },
    },
    http: {
      enabled: true,
      name: env.get('APP_NAME'),
      level: env.get('LOG_LEVEL'),
      transport: {
        targets: targets()
          .pushIf(!app.inProduction, {target: 'adonis-req-logger/pretty'})
          .pushIf(httpLokiTarget !== null, httpLokiTarget!)
          .toArray(),
      },
    },
  },
});
```

Key facts:

- **Two named loggers.** `app` (default) and `http` (used by `adonis-req-logger`,
  `config/req_logger.ts:16`). Both carry `name: APP_NAME`.
- **Pretty vs JSON is env-gated per logger.** Non-production: `app` → `targets.pretty()`
  (`logger.ts:66`), `http` → `adonis-req-logger/pretty` (`logger.ts:84`). Production: no
  pretty target and the stdout file target is **commented out** (`logger.ts:67`), so in
  production the *only* transport is `pino-loki`. Logs do not go to stdout in production.
- **No pino customisation at all.** A repo-wide grep for `base:`, `mixin`, `formatters`,
  `redact` across `apps/community-api/config` and `apps/community-api/start` returns no
  hits. So the log body carries pino's defaults: `level`, `time`, `pid`, `hostname`,
  plus `name` from the logger config. There is no custom `bindings`/`mixin` adding
  `app`, `service_name` or `log_type` into the body — those exist only as Loki labels.
- **Relevant env vars** (`apps/community-api/start/env.ts:18,33-40,60`;
  `apps/community-api/.env.example:4,8,12,14-16`):
  `APP_NAME=community-api`, `LOG_LEVEL`, `APP_ENV`, `LOKI_HOST`, `LOKI_USER`,
  `LOKI_PASSWORD` (secret), `LOKI_ORG_ID`. Loki shipping is on **iff `LOKI_HOST` is set**.
- `getAppEnv()` — `/Users/appifylab/gh/AppifyLab/ezy-web/apps/community-api/utils/constants/index.ts:484-486`:
  `env.get('APP_ENV') ?? (NODE_ENV === 'development' ? 'development' : 'production')`.
  Four values: `development | dev-staging | staging | production`.

### 1.3 Middleware registration / ordering

`/Users/appifylab/gh/AppifyLab/ezy-web/apps/community-api/start/kernel.ts:25-31`

```ts
server.use([
  () => import('#middleware/container_bindings_middleware'),
  () => import('#middleware/force_json_response_middleware'),
  () => import('@adonisjs/cors/cors_middleware'),
  () => import('#middleware/subdomain_and_origin_middleware'),
  () => import('#middleware/host_middleware'), // resolves hostname
  () => import('adonis-req-logger/req_logger_middleware'),
]);
```

`adonis-req-logger` is the **innermost** server middleware — it runs *after*
`host_middleware`. Two consequences:

1. `ctx.community` / `ctx.agency` / `ctx.requestSource` are already populated when the
   logger's `handle()` runs (they are assigned before `next()`, `host_middleware.ts:166-168`).
2. Anything `host_middleware` (or CORS, or the origin guard) throws — notably the
   unknown-host and non-canonical-host **404s** (`host_middleware.ts:155,163`) and the
   cross-origin **403** (`subdomain_and_origin_middleware.ts:48`) — never reaches the
   logger, so those rejections are absent from the `log_type="http"` stream.

---

## 2. How logs reach Loki/Grafana, and where each stream label comes from

### 2.1 There is no log shipper

Searched the whole repo (excluding `node_modules`, worktrees) for `promtail`, `alloy`,
`fluentbit` / `fluent-bit`, `vector.toml`, `otel` / `opentelemetry`, `awslogs`, and
compose `logging:` blocks across `*.yml|*.yaml|*.json|*.toml|*.conf`. **Only hit was
`pnpm-lock.yaml`.** No k8s manifests, no committed ECS task-definition JSON (the deploy
workflow downloads the live one from AWS — see below), no sidecar.

The app pushes to Grafana Cloud Loki **directly, in-process**, via the `pino-loki`
transport declared in `config/logger.ts:27` (`target: 'pino-loki'`), batched every 5s
(`logger.ts:40`). Nothing else is in the path.

### 2.2 Deployment shape (for the `hostname` label)

- ECS on AWS, region from `vars.AWS_REGION`; cluster `vars.ECS_CLUSTER_NAME_COMMUNITY`.
  `/Users/appifylab/gh/AppifyLab/ezy-web/.github/workflows/ecom-unified-deploy.yml:133-157`
  (`aws ecs describe-task-definition` → `amazon-ecs-render-task-definition` →
  `amazon-ecs-deploy-task-definition`).
- Service registry: `/Users/appifylab/gh/AppifyLab/ezy-web/.github/workflows/services-config.json:12-21`
  — `ezycommunity-api`, Dockerfile `./apps/community-api/Dockerfile.prod`,
  task def var `ECS_TASK_DEFINITION_ECOM_API`, service var `ECS_SERVICE_NAME_ECOM_API`.
- The observed `hostname="ip-10-0-158-84.eu-central-1.compute.internal"` is the ECS
  container's own private-DNS hostname (`os.hostname()`), i.e. `eu-central-1`. It is
  **infrastructure identity, not request identity** — it never varies per request and
  never carries a tenant domain.

### 2.3 Label-by-label provenance

| Label | Value seen | Produced where |
| --- | --- | --- |
| `app` | `community-api` | **App code** — `config/logger.ts:33`, `app: env.get('APP_NAME', 'community-api')`, passed as a `pino-loki` `labels` entry. |
| `app_env` | `production` | **App code** — `config/logger.ts:38`, `app_env: getAppEnv()` → `utils/constants/index.ts:484`. |
| `env` | `production` | **App code** — `config/logger.ts:34`, `env: app.inProduction ? 'production' : 'development'`. |
| `log_type` | `http` | **App code** — `config/logger.ts:24,31`; `lokiTarget('http')` is attached to the `http` logger (`logger.ts:50,86`), which `config/req_logger.ts:16` selects. The `app` logger gets `log_type: 'app'` (`logger.ts:49,68`). |
| `hostname` | `ip-10-0-158-84.eu-central-1…` | **`pino-loki` library, hard-coded** — it lifts pino's default `hostname` binding out of the log body and into the stream. Not configurable, not set by app code. |
| `level` | `info` | **`pino-loki` library, hard-coded** — numeric pino level mapped to a status string. |
| `service_name` | `community-api` | **Not produced anywhere in the repo.** Grep for `service_name` across ezy-web hits only unrelated GitHub-Actions job outputs (`.github/workflows/ecom-unified-deploy.yml:31,59,154`; `es-unified.deploy.yml:31,48`) — those are ECS service names for the deploy step and never touch logs. Inference: this is Loki 3.x / Grafana Cloud **automatic `service_name` discovery**, which derives `service_name` from the first present candidate label (`service_name`, `service`, `app`, `application`, `name`, …) — here from `app="community-api"`. Confidence: high, but it is server-side behaviour, unverifiable from this repo. |

Evidence for the two library-injected labels — `pino-loki@3.0.0`
(`/Users/appifylab/gh/AppifyLab/ezy-web/node_modules/.pnpm/pino-loki@3.0.0/node_modules/pino-loki/dist/index.mjs:115-133`):

```js
build(options) {
  const { hostname, ...logWithoutHostname } = options.log;
  const status = this.statusFromLevel(options.log.level);
  ...
  return {
    stream: {
      level: status,
      hostname,
      ...options.additionalLabels,   // ← config/logger.ts labels{}
      ...propsLabels                 // ← from `propsToLabels`, unused here
    },
    ...
```

`additionalLabels` is `this.#options.labels` (`index.mjs:186`). `propsToLabels` is
**not** configured by community-api, so `#buildLabelsFromProps` (`index.mjs:89-91`)
contributes nothing — **today there is no mechanism promoting a log-body field to a Loki
label.** Also note `hostname` is *destructured out* of the body, so it exists only as a
label, never as a JSON field.

---

## 3. Cloudflare / load balancer / `trustProxy` / `allowedHosts`

### 3.1 Cloudflare: yes, and it is load-bearing

- `config/app.ts:12-30` documents the production chain explicitly:
  **"behind Cloudflare → LB → Next SSR"**, and overrides IP resolution on
  `cf-connecting-ip`.
- Cloudflare **SSL-for-SaaS custom hostnames** are provisioned by the app itself:
  `apps/community-api/app/services/cloudflare/custom_hostname` is imported at
  `/Users/appifylab/gh/AppifyLab/ezy-web/apps/community-api/app/modules/community/community.service.ts:69`,
  with `createCustomHostname` / `getCustomHostnameStatus` / `deleteCustomHostname` used at
  `community.service.ts:901,924,949,1033,1052-1058`.
- Zone selection per tenant:
  `/Users/appifylab/gh/AppifyLab/ezy-web/apps/community-api/utils/domain_utils.ts:145-151`
  (`CLOUDFLARE_ZONE_ID` for `ezycommunity.com`, `CLOUDFLARE_ZONE_ID_SITECDN_NET` for
  `communitycdn.net`).
- CI purges the Cloudflare zone after deploying the landing app
  (`.github/workflows/ecom-unified-deploy.yml:170-194`, `cfZoneIdVar` in
  `services-config.json:28`; note the API service has `"cfZoneIdVar": ""`).

### 3.2 Load balancer / reverse proxy: yes

- Production/staging: an LB + reverse proxy/ingress fronts everything and does the
  `/api/*`-vs-rest split. `/Users/appifylab/gh/AppifyLab/ezy-web/docs/STAGING.md:38,63,66-78`:
  wildcard DNS `*.ezysites.com` → "the staging load balancer / ingress", which must
  *"Forward the original host (`x-forwarded-host: pr<N>-<subdomain>.ezysites.com`) and
  `x-forwarded-proto`"* and route `/api/*` → community-api:3333.
- `domain_utils.ts:180-183` states the consequence plainly: *"the backend's own
  `hostname()` is the internal ingress host (no prefix)"*.
- Local dev: Caddy, `/Users/appifylab/gh/AppifyLab/ezy-web/Caddyfile.community` +
  `compose.community.yaml` — `*.ezycommunity.localhost` wildcard, `handle /api/*` →
  `host.docker.internal:3333`, everything else → `:3000`.
- No nginx/traefik config, no k8s ingress manifests, no committed ALB/target-group IaC in
  the repo (infra lives outside this repo; `docs/STAGING.md` is a spec *for* DevOps).

### 3.3 `config/app.ts` — `http.trustProxy` and `allowedHosts`

Neither is set. Repo-wide grep for `trustProxy` / `allowedHosts` in `*.ts`/`*.json`
returns only the doc-comment mention in `config/app.ts:13` and an unrelated
`packages/gallery-v2/src/core/types.ts:135`.

Current `config/app.ts` HTTP block —
`/Users/appifylab/gh/AppifyLab/ezy-web/apps/community-api/config/app.ts:7-52`:

```ts
export const http = defineConfig({
  generateRequestId: true,
  allowMethodSpoofing: false,

  /**
   * Resolve the CLIENT ip, not the proxy's. Without this, `request.ip()` falls
   * back to proxy-addr with the default `trustProxy: 'loopback'` — behind
   * Cloudflare → LB → Next SSR the socket peer is infrastructure, so every
   * visitor resolved to the SAME address. ...
   * `cf-connecting-ip` is set by Cloudflare and always a single address, so it
   * is authoritative here. ...
   */
  getIp(request, originalFn) {
    return request.header('cf-connecting-ip') || originalFn();
  },

  /**
   * Enabling async local storage ... Required so service-layer URL
   * generators (getStageHost/getBaseUrl) can read the current request host
   * to derive the dev-staging `pr<N>-` prefix without threading ctx.
   */
  useAsyncLocalStorage: true,

  cookie: {
    domain: '',
    path: '/',
    maxAge: '2h',
    httpOnly: true,
    secure: app.inProduction,
    sameSite: 'lax',
  },
});
```

So: **`trustProxy` is left at the Adonis default (`'loopback'`)** and client IP is
recovered by a bespoke `getIp` override rather than by trusting proxies.
`useAsyncLocalStorage: true` is on — `HttpContext.get()` works outside the ctx chain
(used by `domain_utils.ts:176-186`).

Practical implication: because `trustProxy` is not widened, **`request.hostname()` /
`request.host()` do not honour `X-Forwarded-Host`.** They return the internal ingress /
bind host. The tenant host must be read from a header explicitly.

---

## 4. Multi-tenant / multi-domain: yes, aggressively

One `community-api` deployment serves **every** tenant, across four base domains plus an
unbounded set of customer-owned custom domains.

### 4.1 Base domains

`/Users/appifylab/gh/AppifyLab/ezy-web/apps/community-api/utils/domain_utils.ts:11-14,316-321`

```ts
export const DEV_DOMAIN       = env.get('DEV_DOMAIN', 'ezycommunity.localhost');
export const PROJECT_DOMAIN   = env.get('PROJECT_DOMAIN', 'ezycommunity.com');
export const COMMUNITY_DOMAIN = env.get('SITE_DOMAIN', 'communitycdn.net');
export const STAGING_DOMAIN   = env.get('STAGING_DOMAIN', 'ezysites.com');
...
export const PLATFORM_BASE_DOMAINS: readonly string[] = [
  PROJECT_DOMAIN, COMMUNITY_DOMAIN, STAGING_DOMAIN, DEV_DOMAIN,
];
```

Host shapes actually served (`domain_utils.ts:196-231`, `docs/STAGING.md:9-30`):

| Stage | Host shape | Example |
| --- | --- | --- |
| production (agency-1 / internal tenants) | `{subdomain}.ezycommunity.com` | `acme.ezycommunity.com` |
| production (sub-agency-sold tenants) | `{subdomain}.communitycdn.net` | `yoga.communitycdn.net` |
| production (custom domain) | arbitrary customer domain | `learn.yoga.com` |
| staging | `staging-{subdomain}.{prodBase}` | `staging-rabbi.ezycommunity.com` |
| dev-staging (per-PR) | `pr{N}-{subdomain}.ezysites.com` | `pr123-restaurant.ezysites.com` |
| development | `{subdomain}.ezycommunity.localhost` | `restaurant.ezycommunity.localhost` |
| marketing / API defaults | `community.ezycommunity.com`, `ezycommunity.com`, `landing.ezycommunity.com` | `getBaseUrl()` no-payload branch, `domain_utils.ts:246-248,357-364`; `config/cors.ts:20` |
| local dev extra | `mail.ezycommunity.localhost` (mailpit) | `Caddyfile.community` |

The base-domain split is a business rule, not cosmetic —
`getProdBaseDomain` (`domain_utils.ts:127-134`): `isInternal || agencyId === 1` →
`ezycommunity.com`, else `communitycdn.net`. Serving a tenant on the *wrong* base is a
hard 404 (`isNonCanonicalBase`, `domain_utils.ts:288-309`; enforced at
`host_middleware.ts:162-164`).

### 4.2 Tenant resolution is by hostname, on every request

`/Users/appifylab/gh/AppifyLab/ezy-web/apps/community-api/app/middleware/host_middleware.ts:18-41`

```ts
/**
 * Resolves the community and its owning agency from the incoming request hostname.
 *
 * Resolution order:
 * 1. `subdomain.ezycommunity.com` / `subdomain.communitycdn.net` → slug = subdomain
 * 2. Custom domain → DB lookup via `Community.where('domain', hostname)`
 * 3. Development (no subdomain) → falls back to `DEFAULT_COMMUNITY_ID`
 */
async function resolveCommunityContext(ctx: HttpContext) {
  const hostname = getHostname(ctx);
  const subdomain = getValidSubdomain(hostname);
  ...
  const payload = isDev && !subdomain ? {id: env.get('DEFAULT_COMMUNITY_ID', 1)}
    : subdomain ? {subdomain} : {domain: hostname};
```

Registered globally at `start/kernel.ts:29`; result cached by hostname
(`host_middleware.ts:43-46`, `cacheTags.hostname`, `TTL.VERY_LONG`), negative-cached for
unknown hosts (`host_middleware.ts:80-83`) explicitly because *"a bot spraying random
subdomains"* would otherwise hit the DB every request.

`getHostname` — `domain_utils.ts:409-421`:

```ts
export function getHostname(ctx: HttpContext) {
  const rawHostname = ctx.request.header(ECOM_HOST_HEADER) || ctx.request.hostname();
  if (!rawHostname) { throw new Exception('Bad Request', {status: 400, code: 'E_BAD_REQUEST'}); }
  return normalizeStageHostname(rawHostname.split(':')[0]);
}
```

`ECOM_HOST_HEADER = 'ECOM_HOST'` —
`/Users/appifylab/gh/AppifyLab/ezy-web/apps/community-api/utils/constants/index.ts:7`.
Precedence is **`ECOM_HOST` header first, `request.hostname()` only as fallback** — the
same precedence appears at `domain_utils.ts:184,281,410`. The frontends set it:
`apps/community/src/http-client/index.ts:16,66` (`const HOST_HEADER = 'ECOM_HOST'`),
`apps/community/src/proxy.ts:195` (`ECOM_HOST: host, // backend tenant resolution`),
`apps/ezycommunity-web/src/http-client/index.ts:6`, plus route handlers at
`apps/community/src/app/api/auth/magic-login/[token]/route.ts:16`,
`.../api/notification/v1/stream/route.ts:15`, `.well-known/*` routes. The frontend derives
that value from `x-forwarded-host || host` (`http-client/index.ts:64`, `proxy.ts:182-186`)
and *also* forwards `x-forwarded-host` (`http-client/index.ts:75`).

`normalizeStageHostname` (`domain_utils.ts:387-405`) strips the deploy-stage prefix
(`pr<N>-`, `staging-`) so `pr123-restaurant.ezysites.com` → `restaurant.ezycommunity.com`,
with a 90-entry exemption list `STAGING_PREFIXED_SUBDOMAINS` (`domain_utils.ts:24-115`)
for tenants whose real subdomain genuinely starts with `staging-`.

### 4.3 Custom domains are unbounded (per-tenant DB column)

- `Community.domain` — *"Custom domain (e.g. community.example.com). Null means
  subdomain-only routing."*
  `/Users/appifylab/gh/AppifyLab/ezy-web/apps/community-api/app/models/community.ts:80`;
  selected on the hot path at `host_middleware.ts:53` and `domain_utils.ts:252`.
- Schema: `table.string('domain', 255).nullable().index()` (and
  `table.string('subdomain', 255).notNullable().unique().index()`) —
  `/Users/appifylab/gh/AppifyLab/ezy-web/apps/community-api/database/migrations/1753686123132_create_tenants_table.ts:11,30`.
- Custom domains are a **billable entitlement**: resource key `custom_domains`
  (`apps/community-api/app/models/resource.ts:37,109,215-216`) and permission migration
  `1793000000007_add_agency_community_domain_permission.ts`.
- `getBaseUrl` prefers the custom domain in production:
  `if (appEnv === 'production' && community.domain) return \`https://${community.domain}\`;`
  (`domain_utils.ts:257-260`).

### 4.4 CORS allowlist and the origin guard

- `config/cors.ts:20,25` — prod allowlist is only
  `['https://ezycommunity.com', 'https://landing.ezycommunity.com']`; dev reflects any
  origin. Deliberately narrow, per the header comment ("never `true`, never a broad
  `*.ezycommunity.com` match"). Tenant hosts are *not* in this list because frontend and
  `/api` share one host (same-origin), so no CORS is needed for them.
- `apps/community-api/app/middleware/subdomain_and_origin_middleware.ts:13-50` — when both
  Host and Origin are platform subdomains they must be byte-identical, else `403 FORBIDDEN`
  (exempting the same two landing origins). Confirms sibling-tenant hosts genuinely reach
  the same process.

### 4.5 Router `domain()`

**Not used.** `grep '\.domain(' apps/community-api` (excluding `build/`) matches only
Redis cache-key helpers (`utils/dns.ts:18,32`). Tenanting is entirely middleware-driven,
not routed via Adonis subdomain routing.

### 4.6 Domains found, consolidated

`ezycommunity.com`, `landing.ezycommunity.com`, `community.ezycommunity.com`,
`*.ezycommunity.com` (per-tenant subdomains), `communitycdn.net` + `*.communitycdn.net`,
`ezysites.com` + `pr<N>-*.ezysites.com`, `staging-*.{ezycommunity.com,communitycdn.net}`,
`ezycommunity.localhost` + `*.ezycommunity.localhost` + `mail.ezycommunity.localhost`,
and **an open-ended set of customer custom domains** (`communities.domain`, Cloudflare
SSL-for-SaaS).

---

## 5. Existing host / `X-Forwarded-Host` logging and reading

### 5.1 A per-request `host` field already exists — in the *other* logger

`/Users/appifylab/gh/AppifyLab/ezy-web/apps/community-api/app/middleware/log_requests_middleware.ts:96-115`

```ts
const traceData = {
  requestId: ctx.request.id(),
  host:
    request.header(ECOM_HOST_HEADER) ||
    request.header('X-Forwarded-Host') ||
    request.host(),
  userId: ctx.auth.user?.id,
  agencyId,
  method: request.method(),
  url: this.redactUrl(request.url()),
  data: safeData,
  headers: this.safeHeaders(request.headers()),
  userAgent: request.header('user-agent'),
  ip: request.header('cf-connecting-ip') || request.ip(),
  statusCode,
  duration: durationMs,
  error: responseError ? {message: responseError.message, stack: responseError.stack} : null,
};
...
pulseRedis.publish('logs:community-api', JSON.stringify(traceData));
```

This is **EzyPulse tracing**, not the access log — the file's own header says so
(`log_requests_middleware.ts:12-13`): *"Publishes a heavy per-request trace (body,
headers) to Redis for EzyPulse. The per-request access log line is adonis-req-logger's job
(config/req_logger.ts)."* It is a **router** middleware (`start/kernel.ts:42`), runs only
for non-GET requests (`log_requests_middleware.ts:42-44`), and publishes to Redis
connection `pulse` — it never reaches pino/Loki.

**The three-step precedence `ECOM_HOST` → `X-Forwarded-Host` → `request.host()` at
`log_requests_middleware.ts:98-101` is the in-repo precedent for how a host field should
be derived here.** The sibling app uses only two steps —
`apps/ezystudio-api/app/middleware/log_requests_middleware.ts:80` reads
`request.header('X-Forwarded-Host') || …` (its tenant header is `ES_HOST`).

### 5.2 Other host readers in community-api

- `domain_utils.ts:409` `getHostname(ctx)` — canonical tenant-host resolver
  (`ECOM_HOST` → `request.hostname()` → normalize). Used by `host_middleware.ts:29` and
  `start/rules/email_checker.ts:31`.
- `domain_utils.ts:176-186` `getStagingPrNumber()` — same precedence, via
  `HttpContext.get()` (AsyncLocalStorage).
- `domain_utils.ts:279-284` `isNonCanonicalHost(ctx, community)` — same precedence.
- `subdomain_and_origin_middleware.ts:31` `request.hostname()` (raw, un-normalized).
- `apps/community-api/utils/staging/index.ts:65-66` — outbound service-to-service calls
  propagate `config.headers[ECOM_HOST_HEADER] || config.headers['x-forwarded-host'] || …`.
- Nothing in community-api logs the host through pino today. Confirmed by grep: no
  `logger.*host` access-log call outside the EzyPulse middleware.

### 5.3 Header spoofing note

`ECOM_HOST` is a plain, client-settable header — the trust model is "origin unreachable
except through Cloudflare", stated for `cf-connecting-ip` at `config/app.ts:21-26`.
The workers explicitly treat both as spoofable and strip them at the edge:
`apps/ezy-wfp/workers/dispatcher/src/index.ts:29` and
`apps/ezy-wfp/workers/outbound/src/index.ts:11` —
`const SPOOFABLE_HEADERS = ['ES_HOST', 'x-forwarded-host'];`

---

## Implications for the logger design

1. **A per-request `host` field is genuinely useful here, and it will vary a lot.**
   One deployment serves every tenant across four base domains plus unbounded
   customer-owned custom domains (§4). Right now a Loki `log_type="http"` line cannot be
   attributed to a tenant at all — `hostname` is the ECS container, and nothing in the
   body carries the request host.

2. **`request.host()` / `request.hostname()` alone would be near-useless in production.**
   `trustProxy` is at its default `'loopback'` (§3.3) and the app sits behind
   Cloudflare → LB → Next SSR, so those return the internal ingress/bind host. Adonis
   would not consult `X-Forwarded-Host` either. A `host` field must therefore be
   **header-derived with a configurable precedence chain**, defaulting to something like
   `X-Forwarded-Host` → `Host`, and allowing the consumer to prepend a custom header
   (`ECOM_HOST` here). Hard-coding only `X-Forwarded-Host` gets community-api ~right but
   misses the header its own frontend actually sets first.

3. **Match the in-repo precedent exactly if you want zero-config adoption:**
   `ECOM_HOST → X-Forwarded-Host → request.host()`
   (`log_requests_middleware.ts:98-101`). Exposing this as e.g.
   `host: {headers: ['ECOM_HOST', 'x-forwarded-host'], fallback: 'request'}` lets
   community-api drop its bespoke derivation and lets `ezystudio-api` use `ES_HOST`.

4. **Emit `host` in the log body, never as a Loki label.** Cardinality is unbounded
   (one label value per custom domain per tenant, plus `pr<N>-` staging permutations), and
   `config/logger.ts:16-23` already states the house rule: *"Labels MUST stay
   low-cardinality (Loki indexes them) — per-request / user ids belong in the log body,
   never here."* Since `propsToLabels` is not configured (§2.3), a body field stays a body
   field automatically — good. Do **not** ship a recipe suggesting `propsToLabels: ['host']`.

5. **`hostname` in the stream is a name collision waiting to happen.** `pino-loki`
   destructures `hostname` out of the body into the stream label (`index.mjs:116,131`).
   If the logger emitted the request host as `hostname`, it would silently **overwrite the
   machine label** in Loki and vanish from the body. Name the field `host` (or
   `req.host` / `http.host`) — not `hostname`. Worth calling out in the docs.

6. **Header values are attacker-controlled.** `ECOM_HOST` / `X-Forwarded-Host` are
   spoofable (§5.3). A logged `host` should be normalised defensively: strip the port,
   lowercase, take only the first comma-separated value (the frontend already does
   `value?.split(',', 1)[0]?.trim()`, `apps/community/src/proxy.ts:26-28`), cap the length,
   and strip control characters — otherwise a crafted header injects junk (or newlines)
   into every log line and, if ever promoted to a label, into Loki's index.

7. **Do not normalise the stage prefix inside the logger.** `pr123-restaurant.ezysites.com`
   and `restaurant.ezycommunity.com` are the *same* tenant to the app
   (`normalizeStageHostname`, `domain_utils.ts:387`), but for an access log the **raw**
   requested host is the more useful datum (it identifies the PR deploy and the exact
   customer domain). Log raw; leave normalisation to the consumer.

8. **Consider a generic "extra fields from ctx" hook rather than a host-only feature.**
   Because `adonis-req-logger` is the innermost server middleware (`kernel.ts:30`),
   `ctx.community`, `ctx.agency` and `ctx.requestSource` are already populated when it
   runs (§1.3). Tenant *id* (bounded-ish, still high cardinality) is at least as valuable
   as the host string, and community-api cannot add it today without forking. A
   documented `fields(ctx)` / `enrich(ctx)` callback would cover host, tenant id, and the
   EzyPulse fields in one stroke — and could let community-api retire
   `log_requests_middleware`'s duplicate work.

9. **Blind spot to flag in the docs (not caused by the host feature, but relevant).**
   Because the logger sits *inside* `host_middleware`, the highest-signal host-related
   responses are never logged: unknown-host 404s, non-canonical-host 404s
   (`host_middleware.ts:155,163`), and cross-origin 403s
   (`subdomain_and_origin_middleware.ts:48`). Exactly the traffic a `host` field would
   help investigate. Either document that the logger should be registered *before*
   tenant-resolution middleware, or note the trade-off (registering it first means
   `ctx.community` is not yet available at request time — though it would be by the time
   the response finishes, which is when the line is emitted).

10. **Production has no stdout target** (`config/logger.ts:67` is commented out), so
    anything the logger emits in production exists *only* if `pino-loki` accepts it. Field
    additions must survive `pino-loki`'s body stringification and must not collide with
    its reserved keys (`hostname`, `level`).

11. **Small consumer-side observation, unrelated to host:** `db.enabled` is tied to
    `DB_DEBUG` (`config/req_logger.ts:52`), which is off in production — so query stats
    are absent from the production `http` stream. Not a logger bug; just context for
    interpreting what a production line contains.
