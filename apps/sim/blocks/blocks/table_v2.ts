import { toError } from '@sim/utils/errors'
import { TableIcon } from '@/components/icons'
import { TABLE_LIMITS } from '@/lib/table/constants'
import { filterRulesToPredicate, sortRulesToSortSpec } from '@/lib/table/query-builder/converters'
import type { FilterRule, SortRule, SortSpec, TablePredicate } from '@/lib/table/types'
import type { BlockConfig } from '@/blocks/types'
import type { TableQueryV2Response } from '@/tools/table/types'
import { getTrigger } from '@/triggers'

/**
 * Table v2 — same operations as the v1 Table block, but the filter grammar is a
 * typed predicate tree (`{all:[{field:'wins',op:'gte',value:10}]}`), validated
 * server-side. Pagination is an opaque cursor (no offset). The filter compiler,
 * upsert conflict probe, and unique checks share one case-sensitive containment
 * leaf, so upserts can't wedge on a case-mismatched unique value the way they
 * could under v1.
 */

function parseJSON(value: string | unknown, fieldName: string): unknown {
  if (typeof value !== 'string') return value
  // A blank editor field means "no filter/order", not malformed JSON. Without
  // this, clearing the field throws `Unexpected end of JSON input` at run time.
  if (value.trim() === '') return undefined
  try {
    return JSON.parse(value)
  } catch (error) {
    const errorMsg = toError(error).message
    const unquotedValueMatch = value.match(
      /:\s*([a-zA-Z][a-zA-Z0-9_\s]*[a-zA-Z0-9]|[a-zA-Z])\s*[,}]/
    )
    let hint =
      'Make sure all property names are in double quotes (e.g., {"name": "value"} not {name: "value"}).'
    if (unquotedValueMatch) {
      hint =
        'It looks like a string value is not quoted. When using block references in JSON, wrap them in double quotes: {"field": "<blockName.output>"} not {"field": <blockName.output>}.'
    }
    throw new Error(`Invalid JSON in ${fieldName}: ${errorMsg}. ${hint}`)
  }
}

interface TableBlockParams {
  operation: string
  tableId?: string
  rowId?: string
  data?: string | unknown
  rows?: string | unknown
  filterInput?: unknown
  sortInput?: unknown
  limit?: string
  cursor?: string
  conflictColumn?: string
}

/**
 * Resolves the effective predicate from the `filterInput` canonical param, which
 * carries whichever mode's value the ⟷ toggle has active: a FilterRule[] (visual
 * builder / basic) or a predicate-JSON string (editor / advanced, agent-authored).
 * An array is builder rules; a string is raw JSON. Both compile to the same
 * `TablePredicate` the route consumes.
 */
function resolveFilter(params: TableBlockParams): TablePredicate | undefined {
  const raw = params.filterInput
  if (Array.isArray(raw)) {
    return raw.length > 0 ? (filterRulesToPredicate(raw as FilterRule[]) ?? undefined) : undefined
  }
  const parsed = parseJSON(raw, 'Filter')
  return (parsed as TablePredicate | undefined) || undefined
}

function resolveOrder(params: TableBlockParams): SortSpec | undefined {
  const raw = params.sortInput
  if (Array.isArray(raw)) {
    return raw.length > 0 ? (sortRulesToSortSpec(raw as SortRule[]) ?? undefined) : undefined
  }
  const parsed = parseJSON(raw, 'Sort')
  return (parsed as SortSpec | undefined) || undefined
}

interface ParsedParams {
  tableId?: string
  rowId?: string
  data?: unknown
  rows?: unknown
  filter?: TablePredicate
  order?: SortSpec
  limit?: number
  cursor?: string
  conflictTarget?: string
}

/**
 * Fail-fast limit parsing for bulk ops: an unparseable limit must never
 * silently widen the operation to every matching row.
 */
function parseOptionalLimit(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const value = Number.parseInt(raw, 10)
  if (Number.isNaN(value)) {
    throw new Error(`Invalid Limit "${raw}" — expected a number.`)
  }
  return value
}

/**
 * `<block.nextCursor>` interpolates the terminating page's `null` as the
 * literal string "null" — treat those artifacts as "no cursor".
 */
function resolveCursor(raw: string | undefined): string | undefined {
  if (!raw || raw === 'null' || raw === 'undefined') return undefined
  return raw
}

const paramTransformers: Record<string, (params: TableBlockParams) => ParsedParams> = {
  insert_row: (params) => ({
    tableId: params.tableId,
    data: parseJSON(params.data, 'Row Data'),
  }),

  upsert_row: (params) => ({
    tableId: params.tableId,
    data: parseJSON(params.data, 'Row Data'),
    conflictTarget: params.conflictColumn || undefined,
  }),

  batch_insert_rows: (params) => ({
    tableId: params.tableId,
    rows: parseJSON(params.rows, 'Rows Data'),
  }),

  update_row: (params) => ({
    tableId: params.tableId,
    rowId: params.rowId,
    data: parseJSON(params.data, 'Row Data'),
  }),

  // Bulk write-by-filter takes a predicate object, validated server-side.
  update_rows_by_filter: (params) => ({
    tableId: params.tableId,
    filter: resolveFilter(params),
    data: parseJSON(params.data, 'Row Data'),
    limit: parseOptionalLimit(params.limit),
  }),

  delete_row: (params) => ({
    tableId: params.tableId,
    rowId: params.rowId,
  }),

  delete_rows_by_filter: (params) => ({
    tableId: params.tableId,
    filter: resolveFilter(params),
    limit: parseOptionalLimit(params.limit),
  }),

  get_row: (params) => ({
    tableId: params.tableId,
    rowId: params.rowId,
  }),

  get_schema: (params) => ({
    tableId: params.tableId,
  }),

  query_rows: (params) => ({
    tableId: params.tableId,
    filter: resolveFilter(params),
    order: resolveOrder(params),
    // Omitted limit returns the entire result (server fails fast over 5MB);
    // with a limit, nextCursor signals when more rows remain.
    limit: parseOptionalLimit(params.limit),
    cursor: resolveCursor(params.cursor),
  }),
}

export const TableV2Block: BlockConfig<TableQueryV2Response> = {
  type: 'table_v2',
  name: 'Table',
  description: 'User-defined data tables',
  longDescription:
    'Create and manage custom data tables. Store, query, and manipulate structured data within workflows. ' +
    'Query Rows filters with a predicate tree — `{"all":[{"field":"wins","op":"gte","value":10}]}` ' +
    '(`all` = AND, `any` = OR; groups nest). Operators: eq, ne, gt, gte, lt, lte, in, nin, like, ilike, ' +
    'nlike, nilike, contains, startsWith, endsWith, isNull, isNotNull, isEmpty, isNotEmpty. Order is a sort ' +
    'spec `[{"field":"wins","direction":"desc"}]`. Query Rows returns every matching row when Limit is omitted ' +
    '(fails if the result exceeds 5MB — add a filter or a Limit). With a Limit, responses page: a non-null ' +
    'nextCursor means more rows exist — pass it back as the cursor.',
  bestPractices: `
- To fetch specific rows, use Query Rows with a predicate filter (e.g. {"all":[{"field":"slack_user_id","op":"in","value":["U1","U2"]}]}) — do NOT read every row and filter downstream with a Condition block.
- Use "Get Row by ID" only when you have the row's id; otherwise filter with a predicate.
- A group is {"all":[...]} (AND) or {"any":[...]} (OR); nest groups as members for mixed logic.
- Example: players who won ≥10 and are active → {"all":[{"field":"wins","op":"gte","value":10},{"field":"status","op":"eq","value":"active"}]}.
- like/ilike use * as the wildcard (e.g. {"field":"name","op":"ilike","value":"*jo*"}).
- Omit Limit to get the entire matching result in one response — the query fails with a clear error if it exceeds 5MB (narrow with a filter or set a Limit).
- With a Limit, pages can end at the Limit or the 5MB byte budget, whichever comes first — pass nextCursor back as the cursor and loop until it is null; never infer completion from page size.
- Columns are scalar (string/number/boolean/date) or opaque json — there are no array columns; for substring use ilike with *x*.`,
  docsLink: 'https://docs.sim.ai/integrations/table',
  category: 'blocks',
  // Unreleased: hidden from every discovery surface until revealed via the hosted
  // `block-visibility` AppConfig document or the `PREVIEW_BLOCKS` env allowlist.
  // Placed instances always execute. At GA: drop this, add the BlockMeta + docs,
  // and mark v1 `table` superseded.
  preview: true,
  bgColor: '#10B981',
  icon: TableIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Query Rows', id: 'query_rows' },
        { label: 'Insert Row', id: 'insert_row' },
        { label: 'Upsert Row', id: 'upsert_row' },
        { label: 'Batch Insert Rows', id: 'batch_insert_rows' },
        { label: 'Update Rows by Filter', id: 'update_rows_by_filter' },
        { label: 'Delete Rows by Filter', id: 'delete_rows_by_filter' },
        { label: 'Update Row by ID', id: 'update_row' },
        { label: 'Delete Row by ID', id: 'delete_row' },
        { label: 'Get Row by ID', id: 'get_row' },
        { label: 'Get Schema', id: 'get_schema' },
      ],
      value: () => 'query_rows',
    },

    {
      id: 'tableSelector',
      title: 'Table',
      type: 'table-selector',
      canonicalParamId: 'tableId',
      mode: 'basic',
      placeholder: 'Select a table',
      required: true,
    },
    {
      id: 'manualTableId',
      title: 'Table ID',
      type: 'short-input',
      canonicalParamId: 'tableId',
      mode: 'advanced',
      placeholder: 'Enter table ID',
      required: true,
    },

    {
      id: 'rowId',
      title: 'Row ID',
      type: 'short-input',
      placeholder: 'row_xxxxx',
      dependsOn: ['tableId'],
      condition: { field: 'operation', value: ['get_row', 'update_row', 'delete_row'] },
      required: true,
    },

    {
      id: 'data',
      title: 'Row Data (JSON)',
      type: 'code',
      placeholder: '{"column_name": "value"}',
      condition: {
        field: 'operation',
        value: ['insert_row', 'upsert_row', 'update_row', 'update_rows_by_filter'],
      },
      required: true,
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `Generate row data as a JSON object matching the table's column schema.

### CONTEXT
{context}

### INSTRUCTION
Return ONLY a valid JSON object with field values based on the table's columns. No explanations or markdown.

IMPORTANT: Reference the table schema visible in the table selector to know which columns exist and their types.

### EXAMPLES

Table with columns: email (string), name (string), age (number)
"user with email john@example.com and age 25"
→ {"email": "john@example.com", "name": "John", "age": 25}

Return ONLY the data JSON:`,
        generationType: 'table-schema',
      },
    },

    {
      id: 'conflictColumnSelector',
      title: 'Conflict Column',
      type: 'column-selector',
      canonicalParamId: 'conflictColumn',
      mode: 'basic',
      selectorKey: 'table.columns',
      placeholder: 'Select a unique column',
      dependsOn: ['tableSelector'],
      condition: { field: 'operation', value: 'upsert_row' },
    },
    {
      id: 'manualConflictColumn',
      title: 'Conflict Column',
      type: 'short-input',
      canonicalParamId: 'conflictColumn',
      mode: 'advanced',
      placeholder: 'Enter the column id',
      dependsOn: ['tableId'],
      condition: { field: 'operation', value: 'upsert_row' },
    },

    {
      id: 'rows',
      title: 'Rows Data (Array of JSON)',
      type: 'code',
      placeholder: '[{"col1": "val1"}, {"col1": "val2"}]',
      condition: { field: 'operation', value: 'batch_insert_rows' },
      required: true,
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `Generate an array of row data objects matching the table's column schema.

### CONTEXT
{context}

### INSTRUCTION
Return ONLY a valid JSON array of objects. Each object represents one row. No explanations or markdown.
Maximum ${TABLE_LIMITS.MAX_BATCH_INSERT_SIZE} rows per batch.

Return ONLY the rows array:`,
        generationType: 'table-schema',
      },
    },

    // Filter — canonical Builder⟷Editor toggle (the ⟷ swap icon on the field),
    // query + bulk update/delete. Basic = visual builder (human-only); Advanced
    // = predicate JSON the agent authors directly. Both members are deliberately
    // NOT `required` (the canonical group must share required status): the service
    // fails closed when no filter resolves for a bulk op ("Filter is required...").
    {
      id: 'filterBuilder',
      title: 'Filter',
      type: 'filter-builder',
      canonicalParamId: 'filterInput',
      mode: 'basic',
      paramVisibility: 'user-only',
      condition: {
        field: 'operation',
        value: ['query_rows', 'update_rows_by_filter', 'delete_rows_by_filter'],
      },
    },
    {
      id: 'filter',
      title: 'Filter',
      type: 'code',
      canonicalParamId: 'filterInput',
      mode: 'advanced',
      placeholder: '{"all":[{"field":"wins","op":"gte","value":10}]}',
      condition: {
        field: 'operation',
        value: ['query_rows', 'update_rows_by_filter', 'delete_rows_by_filter'],
      },
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `Generate a predicate filter object (JSON) for selecting rows.

### CONTEXT
{context}

### INSTRUCTION
Return ONLY the JSON object. No explanations, surrounding quotes, or markdown.

A predicate is a tree: {"all":[...]} (AND) or {"any":[...]} (OR); members are leaves {"field","op","value"} or nested groups.

### OPERATORS
eq, ne, gt, gte, lt, lte, in, nin (in/nin take an array value), like, ilike (use * as the wildcard), nlike, nilike, contains, startsWith, endsWith, isNull, isNotNull, isEmpty, isNotEmpty.

### EXAMPLES
"status is active" → {"all":[{"field":"status","op":"eq","value":"active"}]}
"wins at least 10 and active" → {"all":[{"field":"wins","op":"gte","value":10},{"field":"active","op":"eq","value":true}]}
"status active or pending" → {"any":[{"field":"status","op":"eq","value":"active"},{"field":"status","op":"eq","value":"pending"}]}
"name contains jo (any case)" → {"all":[{"field":"name","op":"ilike","value":"*jo*"}]}

Return ONLY the JSON object:`,
        generationType: 'table-schema',
      },
    },

    // Order — canonical Builder⟷Editor toggle, query only. Basic = visual sort
    // builder (human-only); Advanced = sort-spec JSON the agent authors.
    {
      id: 'sortBuilder',
      title: 'Order',
      type: 'sort-builder',
      canonicalParamId: 'sortInput',
      mode: 'basic',
      paramVisibility: 'user-only',
      condition: { field: 'operation', value: 'query_rows' },
    },
    {
      id: 'order',
      title: 'Order',
      type: 'short-input',
      canonicalParamId: 'sortInput',
      mode: 'advanced',
      placeholder: '[{"field":"wins","direction":"desc"}]',
      condition: { field: 'operation', value: 'query_rows' },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Leave empty for all rows (fails over 5MB)',
      condition: {
        field: 'operation',
        value: ['query_rows', 'update_rows_by_filter', 'delete_rows_by_filter'],
      },
    },
    {
      id: 'cursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'Paste a nextCursor to fetch the next page',
      condition: { field: 'operation', value: 'query_rows' },
    },
    ...getTrigger('table_new_row').subBlocks,
  ],

  tools: {
    access: [
      'table_insert_row',
      'table_batch_insert_rows',
      'table_upsert_row',
      'table_update_row',
      'table_update_rows_by_filter',
      'table_delete_row',
      'table_delete_rows_by_filter',
      'table_query_rows_v2',
      'table_get_row',
      'table_get_schema',
    ],
    config: {
      tool: (params) => {
        const toolMap: Record<string, string> = {
          insert_row: 'table_insert_row',
          batch_insert_rows: 'table_batch_insert_rows',
          upsert_row: 'table_upsert_row',
          update_row: 'table_update_row',
          update_rows_by_filter: 'table_update_rows_by_filter',
          delete_row: 'table_delete_row',
          delete_rows_by_filter: 'table_delete_rows_by_filter',
          query_rows: 'table_query_rows_v2',
          get_row: 'table_get_row',
          get_schema: 'table_get_schema',
        }
        return toolMap[params.operation] || 'table_query_rows_v2'
      },
      params: (params) => {
        const { operation, ...rest } = params
        const transformer = paramTransformers[operation]
        if (transformer) {
          return transformer(rest as TableBlockParams)
        }
        return rest
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Table operation to perform' },
    tableId: { type: 'string', description: 'Table identifier' },
    data: { type: 'json', description: 'Row data for insert/update' },
    rows: { type: 'array', description: 'Array of row data for batch insert' },
    rowId: { type: 'string', description: 'Row identifier for ID-based operations' },
    filterInput: {
      type: 'json',
      description:
        'Filter — a predicate object {"all":[{"field":"wins","op":"gte","value":10}]} (or visual builder conditions). Used by query and bulk update/delete.',
    },
    sortInput: {
      type: 'json',
      description:
        'Order — a sort spec [{"field":"wins","direction":"desc"}] (or visual sort conditions). Query only.',
    },
    limit: {
      type: 'number',
      description:
        'Page row limit (optional — omit to return the entire result, which fails if it exceeds 5MB); optional cap for bulk update/delete',
    },
    cursor: { type: 'string', description: 'Opaque pagination cursor from a prior query response' },
    conflictColumn: {
      type: 'string',
      description:
        'Unique column to match on for upsert (required if the table has multiple unique columns)',
    },
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    row: {
      type: 'json',
      description: 'Single row data',
      condition: {
        field: 'operation',
        value: ['get_row', 'insert_row', 'upsert_row', 'update_row'],
      },
    },
    operation: {
      type: 'string',
      description: 'Operation performed (insert or update)',
      condition: { field: 'operation', value: 'upsert_row' },
    },
    rows: {
      type: 'array',
      description: 'Array of rows',
      condition: { field: 'operation', value: ['query_rows', 'batch_insert_rows'] },
    },
    rowCount: {
      type: 'number',
      description: 'Rows returned (query) or total rows in the table (get schema)',
      condition: { field: 'operation', value: ['query_rows', 'get_schema'] },
    },
    totalCount: {
      type: 'number',
      description: 'Total rows matching the predicate (first page only)',
      condition: { field: 'operation', value: 'query_rows' },
    },
    nextCursor: {
      type: 'string',
      description: 'Cursor to fetch the next page, or null on the last page',
      condition: { field: 'operation', value: 'query_rows' },
    },
    insertedCount: {
      type: 'number',
      description: 'Number of rows inserted',
      condition: { field: 'operation', value: 'batch_insert_rows' },
    },
    updatedCount: {
      type: 'number',
      description: 'Number of rows updated',
      condition: { field: 'operation', value: 'update_rows_by_filter' },
    },
    updatedRowIds: {
      type: 'array',
      description: 'IDs of updated rows',
      condition: { field: 'operation', value: 'update_rows_by_filter' },
    },
    deletedCount: {
      type: 'number',
      description: 'Number of rows deleted',
      condition: { field: 'operation', value: ['delete_row', 'delete_rows_by_filter'] },
    },
    deletedRowIds: {
      type: 'array',
      description: 'IDs of deleted rows',
      condition: { field: 'operation', value: 'delete_rows_by_filter' },
    },
    name: {
      type: 'string',
      description: 'Table name',
      condition: { field: 'operation', value: 'get_schema' },
    },
    columns: {
      type: 'array',
      description: 'Column definitions (each includes its stable id)',
      condition: { field: 'operation', value: 'get_schema' },
    },
    columnCount: {
      type: 'number',
      description: 'Number of columns',
      condition: { field: 'operation', value: 'get_schema' },
    },
    maxRows: {
      type: 'number',
      description: "Max rows per table for the workspace's plan",
      condition: { field: 'operation', value: 'get_schema' },
    },
    message: { type: 'string', description: 'Operation status message' },
  },
  triggers: {
    enabled: true,
    available: ['table_new_row'],
  },
}
