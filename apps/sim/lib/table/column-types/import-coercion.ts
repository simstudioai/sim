import { parseTtlEpochSeconds } from '@/lib/table/column-types/ttl'
import type { ColumnType } from '@/lib/table/column-types/types'
import type { NormalizeDateCellOptions } from '@/lib/table/dates'
import type { JsonValue } from '@/lib/table/types'

type ImportValue = Exclude<JsonValue, Date>
type ImportCoercer = (value: unknown, options?: NormalizeDateCellOptions) => ImportValue

const IMPORT_COERCERS: Partial<Record<ColumnType, ImportCoercer>> = {
  ttl: (value, options) => parseTtlEpochSeconds(value, options),
}

/** Applies lightweight type-specific CSV coercion without loading the full column registry. */
export function coerceColumnTypeImportValue(
  type: ColumnType,
  value: unknown,
  options?: NormalizeDateCellOptions
): ImportValue | undefined {
  return IMPORT_COERCERS[type]?.(value, options)
}
