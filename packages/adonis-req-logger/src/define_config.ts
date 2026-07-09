import { InvalidArgumentsException } from '@adonisjs/core/exceptions'
import string from '@adonisjs/core/helpers/string'

import { REQUEST_LOG_LEVELS } from './levels.js'
import type { RequestLogLevel } from './levels.js'
import type { ReqLoggerConfig, ResolvedReqLoggerConfig } from './types.js'

/**
 * Applies defaults and validates the request logger configuration
 */
export function defineConfig(config: ReqLoggerConfig): ResolvedReqLoggerConfig {
  const sample = config.sample ?? 1
  if (sample < 0 || sample > 1) {
    throw new InvalidArgumentsException('"sample" must be a value between 0 and 1')
  }

  return {
    enabled: config.enabled ?? true,
    logger: config.logger,
    level: validatedLevel(config.level ?? 'info', 'level'),
    skip: config.skip ?? [],
    sample,
    slowRequestThreshold: string.milliseconds.parse(config.slowRequestThreshold ?? 1000),
    db: {
      enabled: config.db?.enabled ?? true,
      slowQueryThreshold: string.milliseconds.parse(config.db?.slowQueryThreshold ?? 100),
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
    throw new InvalidArgumentsException(
      `"${option}" must be one of: ${REQUEST_LOG_LEVELS.join(', ')}`
    )
  }
  return level
}
