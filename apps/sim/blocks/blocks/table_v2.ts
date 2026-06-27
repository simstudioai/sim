import { toError } from '@sim/utils/errors'
import { TableIcon } from '@/components/icons'
import { TABLE_LIMITS } from '@/lib/table/constants'
import {
  filterRulesToPredicate,
  predicateToFilter,
  sortRulesToSortSpec,
} from '@/lib/table/query-builder/converters'
import type { TablePredicate } from '@/lib/table/types'
import type { BlockConfig } from '@/blocks/types'
import type { TableQueryV2Response } from '@/tools/table/types'
import { getTrigger } from '@/triggers'

/** Resolve a bulk-op filter from the predicate grammar (builder or JSON editor). */
function resolveBulkPredicate(
  mode: string | undefined,
  builder: unknown,
  editor: string | unknown
): TablePredicate | null {
  if (mode === 'builder' && builder) {
    return filterRulesToPredicate(builder as Parameters<typeof filterRulesToPredicate>[0])
  }
  if (editor) return parseJSON(editor, 'Predicate') as TablePredicate
  return null
}

/**
 * Table v2 — same operations as the v1 Table block, but `query_rows` speaks the
 * legible `all`/`any` predicate grammar and paginates with an opaque cursor
 * (no offset). The filter compiler, upsert conflict probe, and unique checks all
 * share one case-sensitive containment leaf, so upserts can't wedge on a
 * case-mismatched unique value the way they could under v1.
 */

function parseJSON(value: string | unknown, fieldName: string): unknown {
  if (typeof value !== 'string') return value
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
  bulkPredicate?: string | unknown
  predicate?: string | unknown
  sort?: string | unknown
  limit?: string
  builderMode?: string
  filterBuilder?: unknown
  sortBuilder?: unknown
  bulkFilterMode?: string
  bulkFilterBuilder?: unknown
  conflictColumn?: string
}

interface ParsedParams {
  tableId?: string
  rowId?: string
  data?: unknown
  rows?: unknown
  filter?: unknown
  predicate?: unknown
  sort?: unknown
  limit?: number
  conflictTarget?: string
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

  // Bulk write-by-filter authors in the v2 predicate grammar, then converts to a
  // legacy `Filter` for the existing bulk engine (sync + async-job paths). The
  // conversion is lossless — both compile through the same `fieldPredicate` leaf.
  update_rows_by_filter: (params) => {
    const predicate = resolveBulkPredicate(
      params.bulkFilterMode,
      params.bulkFilterBuilder,
      params.bulkPredicate
    )
    return {
      tableId: params.tableId,
      filter: predicate ? predicateToFilter(predicate) : undefined,
      data: parseJSON(params.data, 'Row Data'),
      limit: params.limit ? Number.parseInt(params.limit) : undefined,
    }
  },

  delete_row: (params) => ({
    tableId: params.tableId,
    rowId: params.rowId,
  }),

  delete_rows_by_filter: (params) => {
    const predicate = resolveBulkPredicate(
      params.bulkFilterMode,
      params.bulkFilterBuilder,
      params.bulkPredicate
    )
    return {
      tableId: params.tableId,
      filter: predicate ? predicateToFilter(predicate) : undefined,
      limit: params.limit ? Number.parseInt(params.limit) : undefined,
    }
  },

  get_row: (params) => ({
    tableId: params.tableId,
    rowId: params.rowId,
  }),

  get_schema: (params) => ({
    tableId: params.tableId,
  }),

  query_rows: (params) => {
    let predicate: unknown
    if (params.builderMode === 'builder' && params.filterBuilder) {
      predicate =
        filterRulesToPredicate(
          params.filterBuilder as Parameters<typeof filterRulesToPredicate>[0]
        ) || undefined
    } else if (params.predicate) {
      predicate = parseJSON(params.predicate, 'Predicate')
    }

    let sort: unknown
    if (params.builderMode === 'builder' && params.sortBuilder) {
      sort =
        sortRulesToSortSpec(params.sortBuilder as Parameters<typeof sortRulesToSortSpec>[0]) ||
        undefined
    } else if (params.sort) {
      sort = parseJSON(params.sort, 'Sort')
    }

    return {
      tableId: params.tableId,
      predicate,
      sort,
      limit: params.limit ? Number.parseInt(params.limit) : 100,
    }
  },
}

export const TableV2Block: BlockConfig<TableQueryV2Response> = {
  type: 'table_v2',
  name: 'Table',
  description: 'User-defined data tables',
  longDescription:
    'Create and manage custom data tables. Store, query, and manipulate structured data within workflows. ' +
    'Query Rows filters with a predicate tree — { all: [...] } is AND, { any: [...] } is OR, and each leaf is ' +
    '{ field, op, value }. Operators: eq, ne, gt, gte, lt, lte, in, nin, contains, ncontains, startsWith, ' +
    'endsWith, isEmpty, isNotEmpty (equality and in are case-sensitive; the text matches are case-insensitive). ' +
    'Pagination is cursor-based: pass the nextCursor from a prior result to fetch the next page.',
  bestPractices: `
- To fetch specific rows, use Query Rows with a predicate (e.g. { all: [{ field: "slack_user_id", op: "in", value: ["U1","U2"] }] }) — do NOT read every row and filter downstream with a Condition block.
- Use "Get Row by ID" only when you have the row's id; there is no fetch-by-value besides the predicate.
- Combine conditions with all (AND) / any (OR); groups nest.
- Example: players who won ≥10 and are active → { all: [{ field: "wins", op: "gte", value: 10 }, { field: "status", op: "eq", value: "active" }] }.
- To page through results, pass the previous response's nextCursor back as the cursor; omit it for the first page.`,
  docsLink: 'https://docs.simstudio.ai/tools/table',
  category: 'blocks',
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

    // Bulk write filter — v2 predicate grammar, converted to a Filter for the bulk engine
    {
      id: 'bulkFilterMode',
      title: 'Filter Mode',
      type: 'dropdown',
      options: [
        { label: 'Builder', id: 'builder' },
        { label: 'Editor', id: 'json' },
      ],
      value: () => 'builder',
      condition: {
        field: 'operation',
        value: ['update_rows_by_filter', 'delete_rows_by_filter'],
      },
    },
    {
      id: 'bulkFilterBuilder',
      title: 'Filter Conditions',
      type: 'filter-builder',
      required: {
        field: 'operation',
        value: ['update_rows_by_filter', 'delete_rows_by_filter'],
      },
      condition: {
        field: 'operation',
        value: ['update_rows_by_filter', 'delete_rows_by_filter'],
        and: { field: 'bulkFilterMode', value: 'builder' },
      },
    },
    {
      id: 'bulkPredicate',
      title: 'Predicate',
      type: 'code',
      placeholder: '{"all": [{"field": "status", "op": "eq", "value": "active"}]}',
      condition: {
        field: 'operation',
        value: ['update_rows_by_filter', 'delete_rows_by_filter'],
        and: { field: 'bulkFilterMode', value: 'json' },
      },
      required: true,
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `Generate a predicate for selecting rows to modify.

### CONTEXT
{context}

### INSTRUCTION
Return ONLY a valid JSON predicate. No explanations or markdown.

A predicate is a nestable tree: { "all": [...] } means AND, { "any": [...] } means OR, and each leaf is { "field", "op", "value" }.

### OPERATORS
eq, ne (case-sensitive equality); gt, gte, lt, lte (comparison); in, nin (array membership); contains, ncontains, startsWith, endsWith (case-insensitive text); isEmpty, isNotEmpty (no value).

### EXAMPLES
"status is archived" → {"all": [{"field": "status", "op": "eq", "value": "archived"}]}
"age under 18 or status banned" → {"any": [{"field": "age", "op": "lt", "value": 18}, {"field": "status", "op": "eq", "value": "banned"}]}

Return ONLY the predicate JSON:`,
        generationType: 'table-schema',
      },
    },

    // Query rows — v2 predicate grammar
    {
      id: 'builderMode',
      title: 'Input Mode',
      type: 'dropdown',
      options: [
        { label: 'Builder', id: 'builder' },
        { label: 'Editor', id: 'json' },
      ],
      value: () => 'builder',
      condition: { field: 'operation', value: 'query_rows' },
    },
    {
      id: 'filterBuilder',
      title: 'Filter Conditions',
      type: 'filter-builder',
      condition: {
        field: 'operation',
        value: 'query_rows',
        and: { field: 'builderMode', value: 'builder' },
      },
    },
    {
      id: 'sortBuilder',
      title: 'Sort Order',
      type: 'sort-builder',
      condition: {
        field: 'operation',
        value: 'query_rows',
        and: { field: 'builderMode', value: 'builder' },
      },
    },
    {
      id: 'predicate',
      title: 'Predicate',
      type: 'code',
      placeholder: '{"all": [{"field": "status", "op": "eq", "value": "active"}]}',
      condition: {
        field: 'operation',
        value: 'query_rows',
        and: { field: 'builderMode', value: 'builder', not: true },
      },
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `Generate a predicate for selecting rows in a table.

### CONTEXT
{context}

### INSTRUCTION
Return ONLY a valid JSON predicate. No explanations or markdown.

A predicate is a nestable tree: { "all": [...] } means AND, { "any": [...] } means OR, and each leaf is { "field", "op", "value" }.

### OPERATORS
- eq / ne: equals / not-equals (case-sensitive)
- gt / gte / lt / lte: numeric or date comparison
- in / nin: value in / not in an array
- contains / ncontains / startsWith / endsWith: case-insensitive text match
- isEmpty / isNotEmpty: cell is null/empty / present (no value)

### EXAMPLES

"rows where status is active"
→ {"all": [{"field": "status", "op": "eq", "value": "active"}]}

"age over 18 and status pending"
→ {"all": [{"field": "age", "op": "gte", "value": 18}, {"field": "status", "op": "eq", "value": "pending"}]}

"status active or pending"
→ {"any": [{"field": "status", "op": "eq", "value": "active"}, {"field": "status", "op": "eq", "value": "pending"}]}

Return ONLY the predicate JSON:`,
        generationType: 'table-schema',
      },
    },
    {
      id: 'sort',
      title: 'Sort',
      type: 'code',
      placeholder: '[{"field": "createdAt", "direction": "desc"}]',
      condition: {
        field: 'operation',
        value: 'query_rows',
        and: { field: 'builderMode', value: 'builder', not: true },
      },
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `Generate sort order for table query results as a JSON array.

### CONTEXT
{context}

### INSTRUCTION
Return ONLY a valid JSON array of { "field", "direction": "asc" | "desc" }. No explanations or markdown.

### EXAMPLES

"newest first" → [{"field": "createdAt", "direction": "desc"}]
"age descending, then name ascending" → [{"field": "age", "direction": "desc"}, {"field": "name", "direction": "asc"}]

Return ONLY the sort JSON:`,
        generationType: 'table-schema',
      },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '100',
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
    bulkFilterMode: {
      type: 'string',
      description: 'Filter input mode for bulk operations (builder or json)',
    },
    bulkFilterBuilder: {
      type: 'json',
      description: 'Visual filter builder conditions for bulk operations',
    },
    bulkPredicate: {
      type: 'json',
      description:
        'Predicate selecting rows for bulk update/delete: nestable { all | any: [...] } of { field, op, value } leaves.',
    },
    predicate: {
      type: 'json',
      description:
        'Query predicate: nestable { all | any: [...] } of { field, op, value } leaves. Operators: eq, ne, gt, gte, lt, lte, in, nin, contains, ncontains, startsWith, endsWith, isEmpty, isNotEmpty.',
    },
    limit: { type: 'number', description: 'Query or bulk operation limit' },
    cursor: { type: 'string', description: 'Opaque pagination cursor from a prior query response' },
    builderMode: {
      type: 'string',
      description: 'Input mode for filter and sort (builder or json)',
    },
    filterBuilder: { type: 'json', description: 'Visual filter builder conditions' },
    sortBuilder: { type: 'json', description: 'Visual sort builder conditions' },
    sort: { type: 'json', description: 'Sort order as [{ field, direction }]' },
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
