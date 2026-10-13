import { type SQL, sql } from 'drizzle-orm'
import { columnTypeOf } from '@/lib/table/column-types/registry'
import { validatedTimestampSql } from '@/lib/table/column-types/timestamp-sql'
import type { ColumnDefinition } from '@/lib/table/types'

/**
 * The database cast an equality match on `column` compares through, or `undefined` when equality is
 * JSONB containment. Only a type with an equality projection compares by cast, which no index serves.
 */
export function equalityCast(column: ColumnDefinition): string | undefined {
  const definition = columnTypeOf(column)
  return definition.valueForEquality ? (definition.jsonbCast ?? undefined) : undefined
}

/** Casts stored text for equality, treating malformed explicit timestamps as absent instants. */
export function columnTextForEquality(cell: SQL, column: ColumnDefinition): SQL {
  const cast = equalityCast(column)
  if (!cast) return cell
  const { timestampValidation } = columnTypeOf(column)
  if (timestampValidation) return validatedTimestampSql(cell, timestampValidation)
  return sql`(${cell})::${sql.raw(cast)}`
}
