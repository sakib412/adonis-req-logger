/*
|--------------------------------------------------------------------------
| adonis-req-logger
|--------------------------------------------------------------------------
|
| Request logging for AdonisJS — one structured, canonical log line per
| HTTP request, with per-request Lucid query stats.
|
*/

export { configure } from './configure.js'
export { defineConfig } from './src/define_config.js'
export { stubsRoot } from './stubs/main.js'
export { REQUEST_LOG_LEVELS } from './src/levels.js'
export type {
  CapturedQuery,
  ReqLoggerConfig,
  RequestLogLevel,
  RequestStore,
  ResolvedReqLoggerConfig,
} from './src/types.js'
