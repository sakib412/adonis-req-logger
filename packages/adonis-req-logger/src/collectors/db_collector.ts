/**
 * Shape of Lucid v18's `db:query` event payload (`DbQueryEventNode`),
 * declared structurally so the package works without `@adonisjs/lucid`
 * installed. `duration` is an hrtime tuple. Failed queries also emit,
 * carrying an undeclared `error` field.
 *
 * The listener that attributes queries to the executing request lands
 * with the DB collector port (issue #5)
 */
export type DbQueryEvent = {
  connection: string
  model?: string
  ddl?: boolean
  duration?: [number, number]
  method: string
  sql: string
  bindings?: unknown[]
  inTransaction?: boolean
}
