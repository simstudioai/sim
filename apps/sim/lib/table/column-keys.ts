/**
 * Column id ↔ name translation helpers.
 *
 * Stored row data (`user_table_rows.data`), table metadata, workflow-group
 * refs, and filter/sort all key on a column's stable **id**. `name` is a
 * display label that changes on rename. The two name-translating boundaries
 * (public v1 API, mothership tool) and CSV convert between the two with the
 * map builders here.
 */

import { generateId } from '@sim/utils/id'
import type {
  ColumnDefinition,
  Filter,
  RowData,
  Sort,
  TableSchema,
  WorkflowGroup,
} from '@/lib/table/types'

/**
 * Resolves a column's stable storage key. Falls back to `name` for legacy
 * columns that predate the id backfill — those rows were written keyed by name,
 * which is exactly the key the column still uses, so the fallback is correct.
 */
export function getColumnId(col: Pick<ColumnDefinition, 'id' | 'name'>): string {
  return col.id ?? col.name
}

/**
 * Mints a fresh column id. Generated ids are opaque (`col_<uuid>`) and
 * deliberately distinct from display names so renames never disturb them. The
 * `col_` prefix is required: the id is validated against `NAME_PATTERN` (it's a
 * JSONB key and a filter/sort field) which must start with a letter/underscore,
 * and a bare UUID can start with a digit. Dashes are stripped for the same
 * reason. A v4 UUID's 122 random bits make a collision within a table's columns
 * effectively impossible, so no uniqueness check is needed.
 */
export function generateColumnId(): string {
  return `col_${generateId().replace(/-/g, '')}`
}

/**
 * Matches a column against a reference that may be a stable id (first-party
 * callers) or a display name (legacy / mothership / public API). Id match is
 * exact; name match is case-insensitive (names are unique case-insensitively per
 * schema validation). The single predicate behind every column-op resolver — use
 * with `.find` / `.findIndex` so id-or-name resolution can't drift between sites.
 */
export function columnMatchesRef(col: ColumnDefinition, ref: string): boolean {
  return getColumnId(col) === ref || col.name.toLowerCase() === ref.toLowerCase()
}

/**
 * Returns a schema copy with a generated id stamped onto every column that
 * lacks one, remapping any workflow-group refs that still hold a column **name**
 * to the assigned id. Used at creation time (`createTable`) so a freshly created
 * table is fully id-keyed from its first row write. Idempotent for columns that
 * already carry an id.
 */
export function withGeneratedColumnIds(schema: TableSchema): TableSchema {
  const idByName = new Map<string, string>()
  const columns = schema.columns.map((col) => {
    if (col.id) {
      idByName.set(col.name, col.id)
      return col
    }
    const id = generateColumnId()
    idByName.set(col.name, id)
    return { ...col, id }
  })

  const remap = (ref: string) => idByName.get(ref) ?? ref
  const workflowGroups = schema.workflowGroups?.map((group) => ({
    ...group,
    outputs: group.outputs.map((o) => ({ ...o, columnName: remap(o.columnName) })),
    ...(group.dependencies?.columns
      ? { dependencies: { columns: group.dependencies.columns.map(remap) } }
      : {}),
    ...(group.inputMappings
      ? {
          inputMappings: group.inputMappings.map((m) => ({
            ...m,
            columnName: remap(m.columnName),
          })),
        }
      : {}),
  }))

  return { ...schema, columns, ...(workflowGroups ? { workflowGroups } : {}) }
}

/**
 * Rewrites a workflow group's column references (output `columnName`,
 * `dependencies.columns`, `inputMapping.columnName`) from display name to stable
 * id using `idByName`. A ref that is already an id (not a known column name) is
 * left as-is, so this is safe whether the caller authored refs by name
 * (mothership) or by id (first-party UI).
 */
export function remapGroupColumnRefs(
  group: WorkflowGroup,
  idByName: ReadonlyMap<string, string>
): WorkflowGroup {
  const remap = (ref: string) => idByName.get(ref) ?? ref
  return {
    ...group,
    outputs: group.outputs.map((o) => ({ ...o, columnName: remap(o.columnName) })),
    ...(group.dependencies?.columns
      ? { dependencies: { columns: group.dependencies.columns.map(remap) } }
      : {}),
    ...(group.inputMappings
      ? {
          inputMappings: group.inputMappings.map((m) => ({
            ...m,
            columnName: remap(m.columnName),
          })),
        }
      : {}),
  }
}

/** `name → id` for translating inbound wire data (v1 / mothership / CSV import). */
export function buildIdByName(schema: TableSchema): Map<string, string> {
  const map = new Map<string, string>()
  for (const col of schema.columns) map.set(col.name, getColumnId(col))
  return map
}

/** `id → name` for translating outbound wire data (v1 / mothership / CSV export). */
export function buildNameById(schema: TableSchema): Map<string, string> {
  const map = new Map<string, string>()
  for (const col of schema.columns) map.set(getColumnId(col), col.name)
  return map
}

/**
 * Remaps a wire row keyed by column **name** to the stored **id** keying. Used
 * at the name-translating boundaries on the way in. Keys not matching a known
 * column are dropped (validation has already run against the schema).
 */
export function rowDataNameToId(data: RowData, idByName: Map<string, string>): RowData {
  const out: RowData = {}
  for (const [name, value] of Object.entries(data)) {
    const id = idByName.get(name)
    if (id !== undefined) out[id] = value
  }
  return out
}

/**
 * Translates a filter's field names → column ids (recursing into `$or`/`$and`).
 * Fields with no matching column (e.g. `createdAt`) pass through unchanged. Used
 * at the name-translating boundaries before handing a filter to the query layer.
 */
export function filterNamesToIds(filter: Filter, idByName: ReadonlyMap<string, string>): Filter {
  const out: Filter = {}
  for (const [key, value] of Object.entries(filter)) {
    if ((key === '$or' || key === '$and') && Array.isArray(value)) {
      out[key] = (value as Filter[]).map((f) => filterNamesToIds(f, idByName))
    } else {
      out[idByName.get(key) ?? key] = value
    }
  }
  return out
}

/** Translates a sort's field names → column ids. Unknown fields pass through. */
export function sortNamesToIds(sort: Sort, idByName: ReadonlyMap<string, string>): Sort {
  const out: Sort = {}
  for (const [field, dir] of Object.entries(sort)) out[idByName.get(field) ?? field] = dir
  return out
}

/**
 * Remaps a stored row keyed by column **id** back to **name** keying for the
 * wire. Used at the name-translating boundaries on the way out. Ids with no
 * current column (e.g. a column deleted by a not-yet-finished background strip)
 * are dropped, so orphaned keys never surface.
 */
export function rowDataIdToName(data: RowData, nameById: Map<string, string>): RowData {
  const out: RowData = {}
  for (const [id, value] of Object.entries(data)) {
    const name = nameById.get(id)
    if (name !== undefined) out[name] = value
  }
  return out
}
