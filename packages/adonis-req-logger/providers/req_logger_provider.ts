import { RuntimeException } from '@adonisjs/core/exceptions'
import type { Logger } from '@adonisjs/core/logger'
import type { ApplicationService } from '@adonisjs/core/types'

import { createDbQueryListener } from '../src/collectors/db_collector.js'
import { logRequest } from '../src/log_request.js'
import ReqLoggerMiddleware from '../src/req_logger_middleware.js'
import type { ResolvedReqLoggerConfig } from '../src/types.js'

export default class ReqLoggerProvider {
  constructor(protected app: ApplicationService) {}

  #config(): ResolvedReqLoggerConfig {
    const config = this.app.config.get<ResolvedReqLoggerConfig | null>('req_logger', null)
    if (!config) {
      throw new RuntimeException(
        'Invalid or missing "config/req_logger.ts" file. Run "node ace configure adonis-req-logger"'
      )
    }
    return config
  }

  register() {
    this.app.container.singleton(ReqLoggerMiddleware, () => {
      return new ReqLoggerMiddleware(this.#config())
    })
  }

  async boot() {
    const config = this.#config()
    if (!config.enabled) {
      return
    }

    const emitter = await this.app.container.make('emitter')
    const loggerManager = await this.app.container.make('logger')
    const logger = config.logger
      ? (loggerManager.use(config.logger as never) as Logger)
      : loggerManager.use()

    emitter.on('http:request_completed', ({ ctx, duration }) => {
      logRequest(ctx, duration, config, logger)
    })

    if (config.db.enabled) {
      /**
       * Typed loosely so `@adonisjs/lucid` stays an optional peer. The
       * event is only emitted when lucid is installed and a connection
       * has `debug: true`
       */
      emitter.on('db:query' as never, createDbQueryListener(config) as never)
      this.#warnWhenLucidDebugIsOff(logger)
    }
  }

  /**
   * `db:query` is only emitted when a Lucid connection has `debug: true`.
   * Surface a hint at boot when db stats are enabled but no connection
   * can emit them
   */
  #warnWhenLucidDebugIsOff(logger: Logger) {
    const database = this.app.config.get<{
      connections?: Record<string, { debug?: boolean }>
    } | null>('database', null)

    if (!database?.connections) {
      return
    }

    const someConnectionInDebug = Object.values(database.connections).some(
      (connection) => connection.debug
    )
    if (!someConnectionInDebug) {
      logger.warn(
        'adonis-req-logger: "db.enabled" is on, but no Lucid connection has "debug: true", so per-request query stats will stay at zero'
      )
    }
  }
}
