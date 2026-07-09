import { AsyncLocalStorage } from 'node:async_hooks'

import type { HttpContext } from '@adonisjs/core/http'

import type { RequestStore } from './types.js'

/**
 * Carries the request store across the async execution of a request so
 * collectors (like the `db:query` listener) can find it. Owned by this
 * package on purpose — it works regardless of the framework's
 * `useAsyncLocalStorage` setting
 */
export const requestStorage = new AsyncLocalStorage<RequestStore>()

/**
 * Bridges the store to the `http:request_completed` listener, which runs
 * on the response "finish" event and is not guaranteed to share the
 * middleware's async context
 */
export const storeByContext = new WeakMap<HttpContext, RequestStore>()

export function createRequestStore(): RequestStore {
  return {
    queriesCount: 0,
    queriesDurationMs: 0,
    queries: [],
    queriesTruncated: false,
  }
}
