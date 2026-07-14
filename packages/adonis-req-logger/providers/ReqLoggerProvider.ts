import onFinished from 'on-finished'

import type { ApplicationContract } from '@ioc:Adonis/Core/Application'
import type { LoggerContract } from '@ioc:Adonis/Core/Logger'

import { createDbQueryListener } from '../src/collectors/db_collector'
import { logRequest, shouldSkip } from '../src/log_request'
import ReqLoggerMiddleware from '../src/ReqLoggerMiddleware'
import { resolveConfig } from '../src/resolve_config'
import type { ResolvedReqLoggerConfig } from '../src/types'

export default class ReqLoggerProvider {
  public static needsApplication = true

  constructor(protected app: ApplicationContract) {}

  private config(): ResolvedReqLoggerConfig {
    const Config = this.app.container.resolveBinding('Adonis/Core/Config')
    const config = Config.get('req_logger', null)
    if (!config) {
      throw new Error(
        'Invalid or missing "config/req_logger.ts" file. Run "node ace configure adonis-req-logger"'
      )
    }
    return resolveConfig(config)
  }

  public register() {
    this.app.container.singleton('Adonis/Addons/ReqLoggerMiddleware', () => {
      return new ReqLoggerMiddleware(this.config())
    })
  }

  /**
   * Hooks must be registered in boot(): server.optimize() commits the
   * hook lists before ready() runs, and empty lists are committed as
   * no-ops — a hook registered in ready() never fires
   */
  public boot() {
    const config = this.config()
    if (!config.enabled) {
      return
    }

    const Server = this.app.container.resolveBinding('Adonis/Core/Server')
    const Logger = this.app.container.resolveBinding('Adonis/Core/Logger')

    /**
     * Request lines emit through a child logger when `bindings` is
     * configured, so every record carries the extra properties (for
     * example `log_type: 'http'`) while the rest of the application's
     * logs stay untouched — v5's single-logger stand-in for the 7.x
     * named `logger` knob
     */
    const requestLogger = Object.keys(config.bindings).length
      ? Logger.child(config.bindings)
      : Logger

    /**
     * A before hook (not a global middleware) is the only v5 vantage
     * point that sees every request — it runs before route matching, so
     * 404s are covered, and the on-finished callback fires once the
     * response is flushed to the socket, after the exception handler has
     * produced the response for errored requests. This reproduces the
     * timing semantics of v7's `http:request_completed` event, which is
     * itself on-finished-driven. The per-request store is created by
     * ReqLoggerMiddleware, so db stats appear only when the middleware
     * is registered — matching the 7.x middleware-optional behavior
     */
    Server.hooks.before(async (ctx) => {
      if (shouldSkip(ctx.request.url(), config.skip)) {
        return
      }

      const start = process.hrtime()
      onFinished(ctx.response.response, () => {
        try {
          logRequest(ctx, process.hrtime(start), config, requestLogger)
        } catch (error) {
          requestLogger.error(
            { err: error },
            'adonis-req-logger: failed to write the request log line'
          )
        }
      })
    })

    if (config.db.enabled) {
      /**
       * Typed loosely so `@adonisjs/lucid` stays an optional peer. The
       * event is only emitted when lucid is installed and the connection
       * has `debug: true`
       */
      const Event = this.app.container.resolveBinding('Adonis/Core/Event')
      Event.on('db:query' as never, createDbQueryListener(config) as never)
      this.warnWhenLucidDebugIsOff(Logger)
    }
  }

  /**
   * `db:query` is only emitted when a Lucid connection has `debug: true`.
   * Surface a hint at boot when db stats are enabled but no connection
   * can emit them
   */
  private warnWhenLucidDebugIsOff(logger: LoggerContract) {
    const Config = this.app.container.resolveBinding('Adonis/Core/Config')
    const database = Config.get('database', null) as {
      connections?: Record<string, { debug?: boolean }>
    } | null

    if (!database || !database.connections) {
      return
    }

    const someConnectionInDebug = Object.keys(database.connections).some(
      (name) => database.connections![name].debug
    )
    if (!someConnectionInDebug) {
      logger.warn(
        'adonis-req-logger: "db.enabled" is on, but no Lucid connection has "debug: true", so per-request query stats will stay at zero'
      )
    }
  }
}
