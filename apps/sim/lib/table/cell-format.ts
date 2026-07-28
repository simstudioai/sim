/**
 * Outbound representation of stored table rows — the counterpart to the inbound
 * `coerceValueToColumnType` switch in `validation.ts`.
 *
 * Row data is keyed by a column's stable **id**, and a `select` cell's stored
 * value is an opaque option **id**. Turning a row into the form consumers see
 * therefore needs two translations — keys and values — and they must happen
 * together: every past bug in this area came from a boundary translating the
 * keys and forgetting the values. {@link namedRowMapper} fuses them into a
 * single pass so they cannot drift apart again.
 */

import { getColumnId } from '@/lib/table/column-keys'
import { selectValueToNames } from '@/lib/table/select-values'
import type { ColumnDefinition, JsonValue, RowData } from '@/lib/table/types'

/**
 * One stored cell value → the value consumers see. `select` resolves option
 * ids to names (an array when `multiple`, dropping ids whose option was
 * deleted); every other column type passes through untouched.
 *
 * The passthrough is load-bearing, not laziness: `rawRow` is documented public
 * trigger output, so a `date`, `json`, `number`, `boolean`, or `string` cell
 * must reach consumers byte-identical to what is stored.
 */
export function formatCellValue(value: unknown, column: ColumnDefinition): JsonValue {
  if (column.type === 'select') return selectValueToNames(column, value)
  return value as JsonValue
}

/**
 * Builds the id-keyed → name-keyed row translator for a set of columns,
 * translating keys and values in one pass.
 *
 * Returns a closure because callers hoist it once per request or export stream:
 * a per-row signature would rebuild the column index for every row inside the
 * paginated export loop. Keys with no current column — e.g. a column deleted by
 * a not-yet-finished background strip — are dropped, so orphaned keys never
 * surface.
 *
 * Takes a column list rather than a schema so callers can pass a filtered set
 * (workflow-column inputs exclude the group's own output columns).
 */
export function namedRowMapper(columns: ColumnDefinition[]): (data: RowData) => RowData {
  const byId = new Map<string, ColumnDefinition>()
  for (const column of columns) byId.set(getColumnId(column), column)

  return (data: RowData): RowData => {
    const out: RowData = {}
    for (const [id, value] of Object.entries(data)) {
      const column = byId.get(id)
      if (column !== undefined) out[column.name] = formatCellValue(value, column)
    }
    return out
  }
}

/**
 * Widens an already name-keyed row to one entry per column, filling absent
 * cells with `null`.
 *
 * For payloads whose field set must match a sibling `headers` array — the table
 * trigger's `row` and the workflow-column `inputRow`. Pass the same column list
 * used to build those headers so the two cannot drift.
 *
 * Absent cells become `null` rather than being run through
 * {@link formatCellValue}: an empty multi-select would otherwise render as `[]`,
 * which downstream emptiness checks do not treat as empty.
 */
export function fillMissingColumns(named: RowData, columns: ColumnDefinition[]): RowData {
  const out: RowData = {}
  for (const column of columns) out[column.name] = named[column.name] ?? null
  return out
}

/**
 * Resolves a workflow group's input mappings to their outward cell values.
 *
 * `WorkflowGroupInputMapping.columnName` holds a column **id**, not a name (the
 * field name is a known misnomer; renaming it is a persisted-schema migration).
 * Mappings referencing a column that no longer exists are skipped.
 *
 * An absent cell stays `undefined` rather than being formatted: an empty
 * multi-select would otherwise become `[]`, which the callers' required-input
 * emptiness checks do not treat as empty, silently running enrichments on rows
 * they currently skip.
 */
export function mapInputValues(
  data: RowData,
  columns: ColumnDefinition[],
  mappings: Array<{ inputName: string; columnName: string }>
): Record<string, unknown> {
  const byId = new Map<string, ColumnDefinition>()
  for (const column of columns) byId.set(getColumnId(column), column)

  const out: Record<string, unknown> = {}
  for (const mapping of mappings) {
    const column = byId.get(mapping.columnName)
    if (column === undefined) continue
    const value = data[mapping.columnName]
    out[mapping.inputName] = value === undefined ? undefined : formatCellValue(value, column)
  }
  return out
}
