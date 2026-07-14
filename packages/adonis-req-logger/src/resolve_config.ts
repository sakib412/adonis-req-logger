import { REQUEST_LOG_LEVELS } from './levels'
import type { ReqLoggerConfig, RequestLogLevel } from '@ioc:Adonis/Addons/ReqLogger'
import type { ResolvedReqLoggerConfig } from './types'

/**
 * Applies defaults and validates the request logger configuration. Runs
 * in the provider at boot — v5 config files export plain objects, so
 * there is no user-facing `defineConfig` on this line
 */
export function resolveConfig(config: ReqLoggerConfig): ResolvedReqLoggerConfig {
  const sample = config.sample ?? 1
  if (sample < 0 || sample > 1) {
    throw new Error('adonis-req-logger: "sample" must be a value between 0 and 1')
  }

  return {
    enabled: config.enabled ?? true,
    level: validatedLevel(config.level ?? 'info', 'level'),
    skip: config.skip ?? [],
    sample,
    slowRequestThreshold: config.slowRequestThreshold ?? 1000,
    bindings: config.bindings ?? {},
    db: {
      enabled: config.db?.enabled ?? true,
      slowQueryThreshold: config.db?.slowQueryThreshold ?? 100,
      slowQueryLevel: validatedLevel(config.db?.slowQueryLevel ?? 'warn', 'db.slowQueryLevel'),
      maxQueries: config.db?.maxQueries ?? 50,
    },
  }
}

/**
 * Config files are not always type-checked, so unknown levels fail
 * loudly at boot instead of producing a crash on the first request
 */
function validatedLevel(level: RequestLogLevel, option: string): RequestLogLevel {
  if (!REQUEST_LOG_LEVELS.includes(level)) {
    throw new Error(
      `adonis-req-logger: "${option}" must be one of: ${REQUEST_LOG_LEVELS.join(', ')}`
    )
  }
  return level
}
