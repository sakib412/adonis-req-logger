import { AsyncLocalStorage } from 'async_hooks'

import type { HttpContextContract } from '@ioc:Adonis/Core/HttpContext'

import type { RequestStore } from './types'

/**
 * Carries the request store across the async execution of a request so
 * collectors (like the `db:query` listener) can find it. Owned by this
 * package on purpose — it works regardless of the framework's
 * `useAsyncLocalStorage` setting
 */
export const requestStorage = new AsyncLocalStorage<RequestStore>()

/**
 * Bridges the store to the on-finished completion callback, which is not
 * guaranteed to share the request's async context. Also the reliable
 * lookup for queries running in the exception handler, which executes
 * outside a middleware-established ALS scope in v5
 */
export const storeByContext = new WeakMap<HttpContextContract, RequestStore>()

export function createRequestStore(): RequestStore {
  return {
    queriesCount: 0,
    queriesDurationMs: 0,
    queries: [],
    queriesTruncated: false,
  }
}
