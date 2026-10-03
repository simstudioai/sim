import { type SQL, sql } from 'drizzle-orm'
import { columnTypeOf } from '@/lib/table/column-types/registry'
import { validatedTimestampSql } from '@/lib/table/column-types/timestamp-sql'
import type { ColumnDefinition } from '@/lib/table/types'

/** Casts stored text for equality, treating malformed explicit timestamps as absent instants. */
export function columnTextForEquality(cell: SQL, column: ColumnDefinition): SQL {
  const definition = columnTypeOf(column)
  if (!definition.valueForEquality || !definition.jsonbCast) return cell
  if (definition.timestampValidation) {
    return validatedTimestampSql(cell, definition.timestampValidation)
  }
  return sql`(${cell})::${sql.raw(definition.jsonbCast)}`
}
