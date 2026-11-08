import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { toRecordOrNull } from '@sim/utils/object'

const logger = createLogger('WorkflowTableRows')

/** One stored row of a `table` sub-block: a stable key and a value per configured column. */
export interface WorkflowTableRow {
  id: string
  cells: Record<string, unknown>
}

/** A row whose every column is blank, as the table seeds and appends them. */
export function createEmptyTableRow(columns: readonly string[]): WorkflowTableRow {
  return { id: generateId(), cells: Object.fromEntries(columns.map((column) => [column, ''])) }
}

/**
 * The rows a `table` sub-block renders from its stored value: one blank row when nothing usable is
 * stored, and otherwise every stored row with each configured column present. A malformed row keeps
 * its place with blank cells, so an edit writes a repaired value rather than losing the row.
 */
export function normalizeTableRows(value: unknown, columns: readonly string[]): WorkflowTableRow[] {
  if (!Array.isArray(value) || value.length === 0) return [createEmptyTableRow(columns)]
  const blank = Object.fromEntries(columns.map((column) => [column, '']))
  return value.map((row: unknown) => {
    const record = toRecordOrNull(row)
    const cells = toRecordOrNull(record?.cells)
    if (!cells) logger.warn('Fixing malformed table row')
    const id = record?.id
    return {
      id: typeof id === 'string' ? id : generateId(),
      cells: { ...blank, ...cells },
    }
  })
}

/** A cell's text: stored strings as they are, anything else blank or stringified. */
export function tableCellText(row: WorkflowTableRow, column: string): string {
  const value = row.cells[column]
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  return String(value)
}
