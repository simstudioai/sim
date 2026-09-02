/**
 * Finds workflow Table blocks whose saved configuration still names a column by
 * its old name after a rename.
 *
 * A rename is metadata-only inside the table — rows, views, and workflow-group
 * refs key on the column's stable id — but a Table block's `filter`, `order`,
 * and `data` are authored JSON that names columns by name. Nothing rewrites
 * workflow state on a rename, so the next run of such a block fails inside its
 * error edge with a lint that stayed clean. This module reports those blocks so
 * the caller can migrate them; it never mutates workflow state.
 */

import { db } from '@sim/db'
import { workflowBlocks, workflow as workflowTable } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import {
  collectPredicateFieldNames,
  collectSortFieldNames,
} from '@/lib/table/query-builder/field-names'

/** Authored-JSON sub-blocks that name columns. */
const COLUMN_REFERENCE_SUB_BLOCKS = ['filter', 'order', 'data'] as const

export type TableBlockColumnReferenceField = (typeof COLUMN_REFERENCE_SUB_BLOCKS)[number]

export interface UnmigratedTableBlockReference {
  workflowId: string
  workflowName: string
  blockId: string
  blockName: string
  /** Sub-block fields that still name the old column. */
  fields: TableBlockColumnReferenceField[]
}

type SubBlockValues = Record<string, { value?: unknown } | undefined>

/** Sub-blocks that bind a Table block to a table, in the order they are consulted. */
const TABLE_ID_SUB_BLOCKS = ['manualTableId', 'tableSelector', 'tableId'] as const

const TABLE_BLOCK_TYPE = 'table_v2'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function subBlockValue(subBlocks: SubBlockValues, id: string): unknown {
  const entry = subBlocks[id]
  return isRecord(entry) ? entry.value : undefined
}

/** The raw text of a sub-block, or `undefined` when it holds nothing. */
function subBlockText(subBlocks: SubBlockValues, id: string): string | undefined {
  const value = subBlockValue(subBlocks, id)
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return value.trim() === '' ? undefined : value
  try {
    return JSON.stringify(value)
  } catch {
    return undefined
  }
}

/** Whether a Table block's configuration binds it to `tableId`. */
export function isTableBlockBoundTo(subBlocks: SubBlockValues, tableId: string): boolean {
  return TABLE_ID_SUB_BLOCKS.some((id) => {
    const value = subBlockValue(subBlocks, id)
    return typeof value === 'string' && value.trim() === tableId
  })
}

/** Every column a row payload names: the keys of the `{ column: value }` object. */
function collectDataFieldNames(root: unknown): string[] {
  return isRecord(root) ? Object.keys(root) : []
}

const FIELD_COLLECTORS: Record<TableBlockColumnReferenceField, (root: unknown) => string[]> = {
  filter: collectPredicateFieldNames,
  order: collectSortFieldNames,
  data: collectDataFieldNames,
}

/**
 * Whether one sub-block's text names `columnName`. Parsed JSON is matched on
 * the column positions the runtime reads (case-insensitively, as the runtime
 * resolves names). Text that is not JSON — a `<block.output>` reference, a
 * template — falls back to a quoted-token match so a reference-bearing filter
 * is still reported rather than silently skipped.
 */
function textReferencesColumn(
  text: string,
  field: TableBlockColumnReferenceField,
  columnName: string
): boolean {
  const wanted = columnName.toLowerCase()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return text.toLowerCase().includes(JSON.stringify(wanted))
  }
  return FIELD_COLLECTORS[field](parsed).some((name) => name.toLowerCase() === wanted)
}

/**
 * The `filter`/`order`/`data` sub-blocks of one Table block that still name
 * `columnName`. Pure: the block's sub-block values are all it reads.
 */
export function collectTableBlockColumnReferences(
  subBlocks: SubBlockValues,
  columnName: string
): TableBlockColumnReferenceField[] {
  const fields: TableBlockColumnReferenceField[] = []
  for (const field of COLUMN_REFERENCE_SUB_BLOCKS) {
    const text = subBlockText(subBlocks, field)
    if (text !== undefined && textReferencesColumn(text, field, columnName)) fields.push(field)
  }
  return fields
}

/**
 * Table blocks across the workspace's live workflow drafts that are bound to
 * `tableId` and still name `columnName` in a filter, sort, or row payload.
 * Read-only; ordered by workflow then block name so a response is stable.
 */
export async function findUnmigratedTableBlockReferences(input: {
  workspaceId: string
  tableId: string
  columnName: string
}): Promise<UnmigratedTableBlockReference[]> {
  const rows = await db
    .select({
      workflowId: workflowTable.id,
      workflowName: workflowTable.name,
      blockId: workflowBlocks.id,
      blockName: workflowBlocks.name,
      subBlocks: workflowBlocks.subBlocks,
    })
    .from(workflowBlocks)
    .innerJoin(workflowTable, eq(workflowBlocks.workflowId, workflowTable.id))
    .where(
      and(
        eq(workflowTable.workspaceId, input.workspaceId),
        isNull(workflowTable.archivedAt),
        eq(workflowBlocks.type, TABLE_BLOCK_TYPE)
      )
    )

  const unmigrated: UnmigratedTableBlockReference[] = []
  for (const row of rows) {
    if (!isRecord(row.subBlocks)) continue
    const subBlocks = row.subBlocks as SubBlockValues
    if (!isTableBlockBoundTo(subBlocks, input.tableId)) continue
    const fields = collectTableBlockColumnReferences(subBlocks, input.columnName)
    if (fields.length === 0) continue
    unmigrated.push({
      workflowId: row.workflowId,
      workflowName: row.workflowName,
      blockId: row.blockId,
      blockName: row.blockName,
      fields,
    })
  }
  return unmigrated.sort(
    (a, b) => a.workflowName.localeCompare(b.workflowName) || a.blockName.localeCompare(b.blockName)
  )
}
