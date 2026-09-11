import { getTableColumns } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'

type InsertTable<TTable extends PgTable, TKey extends keyof TTable['_']['columns']> = PgTable<{
  name: TTable['_']['name']
  schema: TTable['_']['schema']
  dialect: TTable['_']['config']['dialect']
  columns: Pick<TTable['_']['columns'], TKey>
}>

/**
 * Restricts Drizzle's INSERT column list without changing the migration schema.
 * Omitting a value is insufficient: Drizzle still names that column with DEFAULT.
 * The table proxy substitutes the column map exposed by getTableColumns while
 * retaining table metadata, column codecs, defaults, and SQL names.
 * It is local to this insert and never mutates the shared table or its columns.
 */
export function withInsertColumns<
  TTable extends PgTable,
  TKey extends keyof TTable['_']['columns'],
>(table: TTable, columns: Pick<TTable['_']['columns'], TKey>): InsertTable<TTable, TKey> {
  const declaredColumns = getTableColumns(table)
  for (const [name, column] of Object.entries(columns)) {
    if (declaredColumns[name] !== column) {
      throw new Error(`INSERT column ${name} does not belong to the target table`)
    }
  }

  return new Proxy(table, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver)
      return value === declaredColumns ? columns : value
    },
  }) as InsertTable<TTable, TKey>
}
