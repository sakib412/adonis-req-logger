import type { HttpContextContract } from '@ioc:Adonis/Core/HttpContext'

import { shouldSkip } from './log_request'
import { createRequestStore, requestStorage, storeByContext } from './request_store'
import type { ResolvedReqLoggerConfig } from './types'

/**
 * Establishes the per-request store used by collectors and runs the
 * downstream chain inside the package's AsyncLocalStorage so the
 * `db:query` listener can attribute queries to this request.
 *
 * The log line itself is written by the on-finished callback the
 * provider's before hook attaches, so requests are logged even when this
 * middleware is not registered — without it, only the collector data
 * (db stats) is missing. v5 global middleware never runs for unmatched
 * routes, which is harmless here: 404s run no queries
 */
export default class ReqLoggerMiddleware {
  constructor(private config: ResolvedReqLoggerConfig) {}

  public async handle(ctx: HttpContextContract, next: () => Promise<void>) {
    if (!this.config.enabled || shouldSkip(ctx.request.url(), this.config.skip)) {
      return next()
    }

    const store = createRequestStore()
    storeByContext.set(ctx, store)
    return requestStorage.run(store, () => next())
  }
}
