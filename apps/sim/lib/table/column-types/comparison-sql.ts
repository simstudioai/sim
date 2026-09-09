import { type SQL, sql } from 'drizzle-orm'
import { columnTypeOf } from '@/lib/table/column-types/registry'
import type { ColumnDefinition } from '@/lib/table/types'

/** Casts stored text for equality, treating malformed explicit timestamps as absent instants. */
export function columnTextForEquality(cell: SQL, column: ColumnDefinition): SQL {
  const definition = columnTypeOf(column)
  if (!definition.valueForEquality || !definition.jsonbCast) return cell
  const cast = sql`(${cell})::${sql.raw(definition.jsonbCast)}`
  if (!definition.timestampPattern) return cast
  return sql`CASE WHEN ${cell} ~ ${definition.timestampPattern} THEN CASE
    WHEN substring(${cell}, 9, 2)::int <= extract(day FROM (
      make_date(substring(${cell}, 1, 4)::int, substring(${cell}, 6, 2)::int, 1)
        + interval '1 month - 1 day'
    )) THEN ${cast} END END`
}
