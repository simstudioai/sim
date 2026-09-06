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
  PredicateNode,
  RowData,
  Sort,
  SortSpec,
  TablePredicate,
  TableSchema,
  TableViewConfig,
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

/** `name → id` over a bare column list, for callers that hold no full schema. */
export function buildColumnIdByName(columns: readonly ColumnDefinition[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const col of columns) map.set(col.name, getColumnId(col))
  return map
}

/** `id → name` over a bare column list, for callers that hold no full schema. */
export function buildColumnNameById(columns: readonly ColumnDefinition[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const col of columns) map.set(getColumnId(col), col.name)
  return map
}

/** `name → id` for translating inbound wire data (v1 / mothership / CSV import). */
export function buildIdByName(schema: TableSchema): Map<string, string> {
  return buildColumnIdByName(schema.columns)
}

/** `id → name` for translating outbound wire data (v1 / mothership / CSV export). */
export function buildNameById(schema: TableSchema): Map<string, string> {
  return buildColumnNameById(schema.columns)
}

/**
 * Rewrites every column reference in a saved-view config through `refMap`: the
 * layout keys (`columnOrder`, `pinnedColumns`, `hiddenColumns`, and the keys of
 * `columnWidths`), each `sort[].field`, and each `filter` leaf `field`.
 *
 * A ref the map does not know is left as-is, so the rewrite is safe in both
 * directions and both vocabularies: call it with {@link buildColumnIdByName} to
 * store a name-keyed config, and with {@link buildColumnNameById} to present a
 * stored one. Pass-through is what keeps an already-id-keyed config (the
 * first-party UI), a system row column (`createdAt`), and a ref to a
 * since-deleted column intact. The saved-view analogue of
 * {@link remapGroupColumnRefs}.
 */
export function remapViewConfigColumnRefs(
  config: TableViewConfig,
  refMap: ReadonlyMap<string, string>
): TableViewConfig {
  const remap = (ref: string) => refMap.get(ref) ?? ref
  const next: TableViewConfig = { ...config }
  if (config.columnOrder) next.columnOrder = config.columnOrder.map(remap)
  if (config.pinnedColumns) next.pinnedColumns = config.pinnedColumns.map(remap)
  if (config.hiddenColumns) next.hiddenColumns = config.hiddenColumns.map(remap)
  if (config.columnWidths) {
    const widths: Record<string, number> = {}
    for (const [ref, width] of Object.entries(config.columnWidths)) widths[remap(ref)] = width
    next.columnWidths = widths
  }
  if (config.sort) next.sort = sortSpecNamesToIds(config.sort, refMap)
  if (config.filter) next.filter = predicateNamesToIds(config.filter, refMap)
  return next
}

/**
 * Remaps a wire row keyed by column **name** to the stored **id** keying. Used
 * at the name-translating boundaries on the way in. Keys not matching a known
 * column are dropped.
 *
 * Dropping is only safe once someone has established that there are none to
 * drop — a key that survives to here unrecognised is a cell the caller asked to
 * write and the table never stored. Callers on a surface that can answer the
 * client check {@link unknownColumnNames} first; see
 * `rowDataToStorage` in `application/rows.ts`.
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
 * Wire row keys naming no column in `idByName`, in the order they were sent.
 *
 * The v2 row surface is keyed by column **name**, so a stored column **id** is
 * as unknown here as a typo — it names no key the caller could have read off a
 * row, and letting it through would reinstate the silent drop for exactly the
 * callers most likely to believe they had written something.
 */
export function unknownColumnNames(
  data: Readonly<Record<string, unknown>>,
  knownKeys: ReadonlyMap<string, unknown>
): string[] {
  return Object.keys(data).filter((key) => !knownKeys.has(key))
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
 * Translates a v2 predicate's leaf `field` names → column ids (recursing through
 * `all`/`any` groups). Fields with no matching column pass through unchanged.
 * The v2 analogue of {@link filterNamesToIds}.
 */
export function predicateNamesToIds(
  predicate: TablePredicate,
  idByName: ReadonlyMap<string, string>
): TablePredicate {
  const remap = (node: PredicateNode): PredicateNode => {
    // Group-first, matching isPredicateGroup/validateNode/buildPredicateNode.
    if ('all' in node) return { all: node.all.map(remap) }
    if ('any' in node) return { any: node.any.map(remap) }
    return { ...node, field: idByName.get(node.field) ?? node.field }
  }
  return remap(predicate) as TablePredicate
}

/** Translates a v2 sort spec's field names → column ids. Unknown fields pass through. */
export function sortSpecNamesToIds(
  sort: SortSpec,
  idByName: ReadonlyMap<string, string>
): SortSpec {
  return sort.map((s) => ({ field: idByName.get(s.field) ?? s.field, direction: s.direction }))
}

// The outbound direction (stored id-keyed row → name-keyed) deliberately does
// NOT live here: a `select` cell's value also needs translating, and keeping the
// key half separately callable is what let boundaries translate the keys and
// forget the values. Use `namedRowMapper` from `@/lib/table/cell-format`, which
// does both in one pass.
