import env from '#start/env'
import app from '@adonisjs/core/services/app'
import { defineConfig, syncDestination, targets } from '@adonisjs/core/logger'

const loggerConfig = defineConfig({
  /**
   * Default logger name used by ctx.logger and app logger calls.
   */
  default: 'app',

  loggers: {
    app: {
      /**
       * Toggle this logger on/off.
       */
      enabled: true,

      /**
       * Logger name shown in log records.
       */
      name: env.get('APP_NAME'),

      /**
       * Minimum level to output (trace, debug, info, warn, error, fatal).
       */
      level: env.get('LOG_LEVEL'),

      /**
       * Use sync destination in non-production for immediate flush.
       */
      destination: !app.inProduction ? await syncDestination() : undefined,

      /**
       * Configure where logs are written.
       */
      transport: {
        targets: [targets.file({ destination: 1 })],
      },
    },

    /**
     * Request logs written by adonis-req-logger. In dev only the summary
     * line is printed ("GET /users/1 200 12ms") to keep the terminal
     * readable. In production the full structured record is emitted as
     * NDJSON. No "destination" here on purpose — setting it would make
     * pino ignore the transport targets below.
     */
    http: {
      enabled: true,
      name: env.get('APP_NAME'),
      level: 'info',
      transport: {
        targets: targets()
          .pushIf(!app.inProduction, { target: 'adonis-req-logger/pretty', options: {} })
          .pushIf(app.inProduction, targets.file({ destination: 1 }))
          .toArray(),
      },
    },
  },
})

export default loggerConfig

/**
 * Inferring types for the list of loggers you have configured
 * in your application.
 */
declare module '@adonisjs/core/types' {
  export interface LoggersList extends InferLoggers<typeof loggerConfig> {}
}
