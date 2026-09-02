The package has been configured successfully. The request logger config is
stored inside `config/req_logger.ts`.

## Register the middleware (recommended)

Per-request database query stats need the global middleware, which scopes
each request for the `db:query` collector. Add it **first** in the global
middleware list in `start/kernel.ts`, so queries run by your other middleware
(a tenant lookup, an auth token read) count toward the request that caused
them:

```ts
Server.middleware.register([
  () => import('@ioc:Adonis/Addons/ReqLoggerMiddleware'),
  () => import('@ioc:Adonis/Core/BodyParser'),
])
```

Request lines are logged even without the middleware — only the `db` stats
are missing from the record.

## Enable query reporting

Lucid only emits `db:query` when the connection is in debug mode. Inside
`config/database.ts`, set:

```ts
{
  connections: {
    pg: {
      // ...
      debug: true,
    },
  },
}
```

## Enable request ids (recommended)

`request.id()` honors an incoming `x-request-id` header, but generation is
off by default. Inside `config/app.ts`, set:

```ts
export const http: ServerConfig = {
  // ...
  generateRequestId: true,
}
```

## Toggle via environment variable (optional)

To flip request logging without a deploy, wire `enabled` to an environment
variable. Add the rule to `env.ts`:

```ts
export default Env.rules({
  // ...
  REQ_LOGGER_ENABLED: Env.schema.boolean.optional(),
})
```

and use it inside `config/req_logger.ts`:

```ts
enabled: Env.get('REQ_LOGGER_ENABLED', true),
```
