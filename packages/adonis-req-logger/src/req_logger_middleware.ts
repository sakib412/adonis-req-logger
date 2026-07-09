import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

import { shouldSkip } from './log_request.js'
import { createRequestStore, requestStorage, storeByContext } from './request_store.js'
import type { ResolvedReqLoggerConfig } from './types.js'

/**
 * Establishes the per-request store used by collectors. The log line
 * itself is written by the `http:request_completed` listener, so requests
 * are logged even when this middleware is not registered — without it,
 * only the collector data (db stats) is missing
 */
export default class ReqLoggerMiddleware {
  constructor(protected config: ResolvedReqLoggerConfig) {}

  async handle(ctx: HttpContext, next: NextFn) {
    if (!this.config.enabled || shouldSkip(ctx.request.url(), this.config.skip)) {
      return next()
    }

    const store = createRequestStore()
    storeByContext.set(ctx, store)
    return requestStorage.run(store, () => next())
  }
}
