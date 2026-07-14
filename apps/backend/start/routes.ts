/*
|--------------------------------------------------------------------------
| Routes
|--------------------------------------------------------------------------
|
| Demo routes exercising every adonis-req-logger behavior: a plain
| request, a request running Lucid queries, a slow request, an errored
| request, and a skipped health check.
|
*/

import Route from '@ioc:Adonis/Core/Route'
import Database from '@ioc:Adonis/Lucid/Database'

Route.get('/', async () => {
  return { hello: 'world' }
})

Route.get('/users/:id', async ({ params }) => {
  const [user] = await Database.rawQuery('select :id as id, :name as name', {
    id: Number(params.id),
    name: 'demo-user',
  })
  const [stats] = await Database.rawQuery('select 1 as visits')
  return { user, stats }
})

Route.get('/slow', async () => {
  await new Promise((resolve) => setTimeout(resolve, 1200))
  return { slow: true }
})

Route.get('/error', async () => {
  throw new Error('Boom')
})

Route.get('/health', async () => {
  return { ok: true }
})
