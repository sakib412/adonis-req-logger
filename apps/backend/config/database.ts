import Application from '@ioc:Adonis/Core/Application'
import type { DatabaseConfig } from '@ioc:Adonis/Lucid/Database'

const databaseConfig: DatabaseConfig = {
  connection: 'sqlite',

  connections: {
    sqlite: {
      client: 'sqlite3',
      connection: {
        filename: Application.tmpPath('db.sqlite3'),
      },
      useNullAsDefault: true,
      /**
       * Lucid emits `db:query` (which adonis-req-logger's per-request
       * stats rely on) only when debug is enabled
       */
      debug: true,
    },
  },
}

export default databaseConfig
