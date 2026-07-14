import type { ApplicationContract } from '@ioc:Adonis/Core/Application'

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

  public boot() {
    const config = this.config()
    if (!config.enabled) {
      return
    }

    /**
     * The request timing hook (Server.hooks.before + on-finished on the
     * raw response) must be registered here in boot() — server.optimize()
     * commits the hook lists before ready() runs, so ready() is too late.
     * The wiring lands with the core port (issue #4); the db:query
     * listener with the collector port (issue #5)
     */
  }
}
