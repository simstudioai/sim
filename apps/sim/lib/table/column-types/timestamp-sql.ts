import { type SQL, sql } from 'drizzle-orm'
import type { TimestampValidation } from '@/lib/table/column-types/types'

/** PostgreSQL 16+ validates the cast; the format and precision rules prevent implicit or rounded instants. */
export function validatedTimestampSql(cell: SQL, validation: TimestampValidation): SQL {
  return sql`CASE
    WHEN ${cell} ~* ${validation.pattern}
      AND pg_input_is_valid(${cell}, 'timestamptz')
      AND COALESCE(length(substring(${cell} from '[.]([0-9]+)')), 0) <= ${validation.maxFractionDigits}
    THEN (${cell})::timestamptz
  END`
}
