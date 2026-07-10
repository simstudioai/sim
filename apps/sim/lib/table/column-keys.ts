/**
 * Column id ↔ name translation helpers.
 *
 * Stored row data (`user_table_rows.data`), table metadata, workflow-group
 * refs, and filter/sort all key on a column's stable **id**. `name` is a
 * display label that changes on rename. The two name-translating boundaries
 * (public v1 API, mothership tool) and CSV convert between the two with the
 * map builders here. Also hosts the write-time display-name validator
 * (`assertValidNewColumnName`) since it depends on the id/name semantics.
 */

import { generateId } from '@sim/utils/id'
import { COLUMN_NAME_PATTERN, COLUMN_NAME_RULE, TABLE_LIMITS } from '@/lib/table/constants'
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
 * True when `name` equals some other column's storage key. Such a name would
 * make `columnMatchesRef` and the name→id remaps ambiguous (a ref intended for
 * the other column's id would resolve by name instead) — reject it at write
 * time. `excludeIndex` skips the column being renamed.
 */
export function nameShadowsColumnId(
  columns: readonly ColumnDefinition[],
  name: string,
  excludeIndex = -1
): boolean {
  return columns.some((c, i) => i !== excludeIndex && getColumnId(c) === name)
}

/**
 * The single write-time validator for a column display name: pattern, length,
 * case-insensitive uniqueness against `columns`, and id shadowing. Every
 * column-creating or renaming service path calls this so the rule can never
 * drift between them. The pattern/length rules mirror `validateColumnDefinition`
 * (validation.ts), which accumulates errors for bulk schema checks — duplicated
 * because validation.ts is server-only while this module is client-safe.
 *
 * `excludeIndex` skips the column being renamed. `extraTakenLower` holds
 * LOWERCASED names claimed earlier in the same batch; an accepted name is
 * claimed into it before returning, so batch callers never hand-maintain the
 * set. Throws with a caller-facing message on the first violation.
 */
export function assertValidNewColumnName(
  name: string,
  columns: readonly ColumnDefinition[],
  options: { excludeIndex?: number; extraTakenLower?: Set<string> } = {}
): void {
  const { excludeIndex = -1, extraTakenLower } = options
  if (!COLUMN_NAME_PATTERN.test(name)) {
    throw new Error(`Invalid column name "${name}". ${COLUMN_NAME_RULE}.`)
  }
  if (name.length > TABLE_LIMITS.MAX_COLUMN_NAME_LENGTH) {
    throw new Error(
      `Column name exceeds maximum length (${TABLE_LIMITS.MAX_COLUMN_NAME_LENGTH} characters)`
    )
  }
  const lower = name.toLowerCase()
  if (
    columns.some((c, i) => i !== excludeIndex && c.name.toLowerCase() === lower) ||
    extraTakenLower?.has(lower)
  ) {
    throw new Error(`Column "${name}" already exists`)
  }
  if (nameShadowsColumnId(columns, name, excludeIndex)) {
    throw new Error(`Column name "${name}" conflicts with another column's id`)
  }
  extraTakenLower?.add(lower)
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

/**
 * `lowercased name → id` for translating inbound wire data (v1 / mothership /
 * CSV import). Keys are lowercased so lookups match the schema's
 * case-insensitive name uniqueness — the same semantics as `columnMatchesRef` —
 * instead of silently dropping a miscased key. Look up via `idForName`.
 */
export function buildIdByName(schema: TableSchema): Map<string, string> {
  const map = new Map<string, string>()
  for (const col of schema.columns) map.set(col.name.toLowerCase(), getColumnId(col))
  return map
}

/** Case-insensitive lookup into a {@link buildIdByName} map. */
function idForName(idByName: ReadonlyMap<string, string>, name: string): string | undefined {
  return idByName.get(name.toLowerCase())
}

/** `id → name` for translating outbound wire data (v1 / mothership / CSV export). */
export function buildNameById(schema: TableSchema): Map<string, string> {
  const map = new Map<string, string>()
  for (const col of schema.columns) map.set(getColumnId(col), col.name)
  return map
}

/**
 * Remaps a wire row keyed by column **name** to the stored **id** keying. Used
 * at the name-translating boundaries on the way in. Names match
 * case-insensitively (mirroring `columnMatchesRef`); keys not matching a known
 * column are dropped (validation has already run against the schema).
 */
export function rowDataNameToId(data: RowData, idByName: Map<string, string>): RowData {
  const out: RowData = {}
  for (const [name, value] of Object.entries(data)) {
    const id = idForName(idByName, name)
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
      out[idForName(idByName, key) ?? key] = value
    }
  }
  return out
}

/** Translates a sort's field names → column ids. Unknown fields pass through. */
export function sortNamesToIds(sort: Sort, idByName: ReadonlyMap<string, string>): Sort {
  const out: Sort = {}
  for (const [field, dir] of Object.entries(sort)) out[idForName(idByName, field) ?? field] = dir
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
