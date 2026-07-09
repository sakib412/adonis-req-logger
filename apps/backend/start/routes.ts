/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import { middleware } from '#start/kernel'
import router from '@adonisjs/core/services/router'
import { controllers } from '#generated/controllers'
import User from '#models/user'
import db from '@adonisjs/lucid/services/db'

router.get('/', () => {
  return { hello: 'world' }
})

/**
 * Demo routes for exercising adonis-req-logger's per-request
 * query stats with different query patterns.
 */
router
  .group(() => {
    /**
     * Single query.
     */
    router.get('users', async () => {
      const users = await User.all()
      return { users: users.length }
    })

    /**
     * Classic N+1: one query for the list, one more per row.
     */
    router.get('n-plus-one', async () => {
      const users = await User.all()
      for (const user of users) {
        await db.from('auth_access_tokens').where('tokenable_id', user.id)
      }
      return { users: users.length }
    })

    /**
     * A single deliberately slow query, to trip "slowQueryThreshold"
     * and get itemized in the log record.
     */
    router.get('slow-query', async () => {
      await db.rawQuery(
        'WITH RECURSIVE counter(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM counter WHERE n < 3000000) SELECT COUNT(*) AS total FROM counter'
      )
      return { done: true }
    })
  })
  .prefix('/demo')

router
  .group(() => {
    router
      .group(() => {
        router.post('signup', [controllers.NewAccount, 'store'])
        router.post('login', [controllers.AccessTokens, 'store'])
      })
      .prefix('auth')
      .as('auth')

    router
      .group(() => {
        router.get('profile', [controllers.Profile, 'show'])
        router.post('logout', [controllers.AccessTokens, 'destroy'])
      })
      .prefix('account')
      .as('profile')
      .use(middleware.auth())
  })
  .prefix('/api/v1')
