import Env from '@ioc:Adonis/Core/Env'
import { ReqLoggerConfig } from '@ioc:Adonis/Addons/ReqLogger'

const reqLoggerConfig: ReqLoggerConfig = {
  /**
   * Turn request logging on/off without a deploy.
   */
  enabled: Env.get('REQ_LOGGER_ENABLED', true),

  /**
   * Base level for requests that trigger no escalation. Errors, slow
   * requests, and slow queries always log above this floor.
   */
  level: 'info',

  /**
   * Paths that never get logged. Strings match the exact path or a
   * path prefix, regular expressions are tested against the path.
   */
  skip: ['/health'],

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
   * Extra properties on every request record, applied as child-logger
   * bindings. "log_type" becomes a Grafana Loki label via propsToLabels
   * in config/app.ts, so request lines filter separately from
   * application logs.
   */
  bindings: { log_type: 'http' },

  /**
   * Per-request database query stats. Requires a Lucid connection with
   * "debug: true" in "config/database.ts".
   */
  db: {
    enabled: true,
    slowQueryThreshold: 100,
    slowQueryLevel: 'warn',
    maxQueries: 50,
  },
}

export default reqLoggerConfig
