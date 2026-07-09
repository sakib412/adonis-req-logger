/*
|--------------------------------------------------------------------------
| Configure hook
|--------------------------------------------------------------------------
|
| Invoked by "node ace configure adonis-req-logger". Publishes the config
| file, registers the provider and the server middleware, and defines the
| environment variables.
|
*/

import type Configure from '@adonisjs/core/commands/configure'

import { stubsRoot } from './stubs/main.js'

export async function configure(command: Configure) {
  const codemods = await command.createCodemods()

  /**
   * Publish config file
   */
  await codemods.makeUsingStub(stubsRoot, 'config/req_logger.stub', {})

  /**
   * Define environment variables and their validations
   */
  await codemods.defineEnvVariables({ REQ_LOGGER_ENABLED: 'true' })
  await codemods.defineEnvValidations({
    variables: {
      REQ_LOGGER_ENABLED: 'Env.schema.boolean.optional()',
    },
    leadingComment: 'Variables for configuring adonis-req-logger',
  })

  /**
   * Register the middleware with the server stack, so unmatched
   * routes (404s) are covered as well
   */
  await codemods.registerMiddleware('server', [
    { path: 'adonis-req-logger/req_logger_middleware' },
  ])

  /**
   * Register provider
   */
  await codemods.updateRcFile((rcFile) => {
    rcFile.addProvider('adonis-req-logger/req_logger_provider')
  })
}
