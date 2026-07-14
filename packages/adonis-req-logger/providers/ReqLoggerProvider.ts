import onFinished from 'on-finished'

import type { ApplicationContract } from '@ioc:Adonis/Core/Application'

import { logRequest, shouldSkip } from '../src/log_request'
import { createRequestStore, storeByContext } from '../src/request_store'
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

  public register() {}

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
     * A before hook (not a global middleware) is the only v5 vantage
     * point that sees every request — it runs before route matching, so
     * 404s are covered, and the on-finished callback fires once the
     * response is flushed to the socket, after the exception handler has
     * produced the response for errored requests. This reproduces the
     * timing semantics of v7's `http:request_completed` event, which is
     * itself on-finished-driven
     */
    Server.hooks.before(async (ctx) => {
      if (shouldSkip(ctx.request.url(), config.skip)) {
        return
      }

      storeByContext.set(ctx, createRequestStore())

      const start = process.hrtime()
      onFinished(ctx.response.response, () => {
        try {
          logRequest(ctx, process.hrtime(start), config, Logger)
        } catch (error) {
          Logger.error({ err: error }, 'adonis-req-logger: failed to write the request log line')
        }
      })
    })
  }
}
