/**
 * Config source: https://git.io/JfefZ
 *
 * Feel free to let us know via PR, if you find something broken in this config
 * file.
 */

import proxyAddr from 'proxy-addr'
import pinoms from 'pino-multi-stream'
import { pinoLoki } from 'pino-loki'
import Env from '@ioc:Adonis/Core/Env'
import type { ServerConfig } from '@ioc:Adonis/Core/Server'
import type { LoggerConfig } from '@ioc:Adonis/Core/Logger'
import type { ProfilerConfig } from '@ioc:Adonis/Core/Profiler'
import type { ValidatorConfig } from '@ioc:Adonis/Core/Validator'

/*
|--------------------------------------------------------------------------
| Application secret key
|--------------------------------------------------------------------------
|
| The secret to encrypt and sign different values in your application.
| Make sure to keep the `APP_KEY` as an environment variable and secure.
|
| Note: Changing the application key for an existing app will make all
| the cookies invalid and also the existing encrypted data will not
| be decrypted.
|
*/
export const appKey: string = Env.get('APP_KEY')

/*
|--------------------------------------------------------------------------
| Http server configuration
|--------------------------------------------------------------------------
|
| The configuration for the HTTP(s) server. Make sure to go through all
| the config properties to make keep server secure.
|
*/
export const http: ServerConfig = {
  /*
  |--------------------------------------------------------------------------
  | Allow method spoofing
  |--------------------------------------------------------------------------
  |
  | Method spoofing enables defining custom HTTP methods using a query string
  | `_method`. This is usually required when you are making traditional
  | form requests and wants to use HTTP verbs like `PUT`, `DELETE` and
  | so on.
  |
  */
  allowMethodSpoofing: false,

  /*
  |--------------------------------------------------------------------------
  | Subdomain offset
  |--------------------------------------------------------------------------
  */
  subdomainOffset: 2,

  /*
  |--------------------------------------------------------------------------
  | Request Ids
  |--------------------------------------------------------------------------
  |
  | Setting this value to `true` will generate a unique request id for each
  | HTTP request and set it as `x-request-id` header.
  |
  */
  generateRequestId: true,

  /*
  |--------------------------------------------------------------------------
  | Trusting proxy servers
  |--------------------------------------------------------------------------
  |
  | Define the proxy servers that AdonisJs must trust for reading `X-Forwarded`
  | headers.
  |
  */
  trustProxy: proxyAddr.compile('loopback'),

  /*
  |--------------------------------------------------------------------------
  | Generating Etag
  |--------------------------------------------------------------------------
  |
  | Whether or not to generate an etag for every response.
  |
  */
  etag: false,

  /*
  |--------------------------------------------------------------------------
  | JSONP Callback
  |--------------------------------------------------------------------------
  */
  jsonpCallbackName: 'callback',

  /*
  |--------------------------------------------------------------------------
  | Cookie settings
  |--------------------------------------------------------------------------
  */
  cookie: {
    domain: '',
    path: '/',
    maxAge: '2h',
    httpOnly: true,
    secure: false,
    sameSite: false,
  },

  /*
  |--------------------------------------------------------------------------
  | Force Content Negotiation
  |--------------------------------------------------------------------------
  |
  | The internals of the framework relies on the content negotiation to
  | detect the best possible response type for a given HTTP request.
  |
  | However, it is a very common these days that API servers always wants to
  | make response in JSON regardless of the existence of the `Accept` header.
  |
  | By setting `forceContentNegotiationTo = 'application/json'`, you negotiate
  | with the server in advance to always return JSON without relying on the
  | client to set the header explicitly.
  |
  */
  forceContentNegotiationTo: 'application/json',
}

/*
|--------------------------------------------------------------------------
| Logger
|--------------------------------------------------------------------------
|
| pino 6 (AdonisJS v5) has no transport targets, so log destinations are
| composed as a multistream and handed to the logger through the `stream`
| config option. `prettyPrint` must stay unset here: pretty printing runs
| as its own stream inside the multistream, otherwise every destination
| (including Loki) would receive colorized text instead of NDJSON.
|
| Shipping to Grafana Loki is config-driven: it turns on only when
| LOKI_HOST is set, so local dev (var unset) is untouched while
| staging/production opt in. Labels MUST stay low-cardinality (Loki
| indexes them) — per-request/user ids belong in the log body, never in
| labels. `log_type` is promoted from log properties to a Loki label via
| `propsToLabels`; `config/req_logger.ts` sets `bindings.log_type` to
| "http" so request lines filter separately from application logs.
|
*/
const logLevel = Env.get('LOG_LEVEL', 'info')

// pino-loki appends the push path (/loki/api/v1/push) to `host` itself, so
// LOKI_HOST must be the BASE url only (e.g. https://<stack>.grafana.net).
const lokiHost = Env.get('LOKI_HOST')
const lokiUser = Env.get('LOKI_USER')
const lokiPassword = Env.get('LOKI_PASSWORD')

/**
 * Streams without an explicit `level` default to "info" inside
 * pino-multi-stream, so every entry pins it to LOG_LEVEL.
 */
const loggerStreams: pinoms.Streams = [
  Env.get('NODE_ENV') === 'development'
    ? {
        level: logLevel,
        stream: pinoms.prettyStream({
          prettyPrint: {
            colorize: true,
            translateTime: 'dd/mm/yyyy HH:MM:ss.l',
            singleLine: true,
          },
        }),
      }
    : { level: logLevel, stream: process.stdout },
]

if (lokiHost) {
  loggerStreams.push({
    level: logLevel,
    stream: pinoLoki({
      host: lokiHost,
      labels: {
        app: Env.get('APP_NAME'),
        env: Env.get('NODE_ENV'),
      },
      propsToLabels: ['log_type'],
      batching: { interval: 5 }, // 5s batches — pushes never block the event loop
      ...(lokiUser && lokiPassword
        ? { basicAuth: { username: lokiUser, password: lokiPassword } }
        : {}),
    }),
  })
}

export const logger: LoggerConfig = {
  /*
  |--------------------------------------------------------------------------
  | Application name
  |--------------------------------------------------------------------------
  |
  | The name of the application you want to add to the log. It is recommended
  | to always have app name in every log line.
  |
  | The `APP_NAME` environment variable is automatically set by AdonisJS by
  | reading the `name` property from the `package.json` file.
  |
  */
  name: Env.get('APP_NAME'),

  /*
  |--------------------------------------------------------------------------
  | Toggle logger
  |--------------------------------------------------------------------------
  |
  | Enable or disable logger application wide
  |
  */
  enabled: true,

  /*
  |--------------------------------------------------------------------------
  | Logging level
  |--------------------------------------------------------------------------
  |
  | The level from which you want the logger to flush logs. It is recommended
  | to make use of the environment variable, so that you can define log levels
  | at deployment level and not code level.
  |
  */
  level: logLevel,

  /*
  |--------------------------------------------------------------------------
  | Destination streams
  |--------------------------------------------------------------------------
  |
  | Composed above: pretty stdout in development, raw NDJSON stdout
  | otherwise, plus Grafana Loki whenever LOKI_HOST is set.
  |
  */
  stream: pinoms.multistream(loggerStreams),
}

/*
|--------------------------------------------------------------------------
| Profiler
|--------------------------------------------------------------------------
*/
export const profiler: ProfilerConfig = {
  /*
  |--------------------------------------------------------------------------
  | Toggle profiler
  |--------------------------------------------------------------------------
  |
  | Enable or disable profiler
  |
  */
  enabled: true,

  /*
  |--------------------------------------------------------------------------
  | Blacklist actions/row labels
  |--------------------------------------------------------------------------
  |
  | Define an array of actions or row labels that you want to disable from
  | getting profiled.
  |
  */
  blacklist: [],

  /*
  |--------------------------------------------------------------------------
  | Whitelist actions/row labels
  |--------------------------------------------------------------------------
  |
  | Define an array of actions or row labels that you want to whitelist for
  | the profiler. When whitelist is defined, then `blacklist` is ignored.
  |
  */
  whitelist: [],
}

/*
|--------------------------------------------------------------------------
| Validator
|--------------------------------------------------------------------------
|
| Configure the global configuration for the validator. Here's the reference
| to the default config https://git.io/JT0WE
|
*/
export const validator: ValidatorConfig = {}
