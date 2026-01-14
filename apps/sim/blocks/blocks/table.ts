import { TableIcon } from '@/components/icons'
import { conditionsToFilter, sortConditionsToSort } from '@/lib/table/filter-builder-utils'
import type { BlockConfig } from '@/blocks/types'
import type { TableQueryResponse } from '@/tools/table/types'

export const TableBlock: BlockConfig<TableQueryResponse> = {
  type: 'table',
  name: 'Table',
  description: 'User-defined data tables',
  longDescription:
    'Create and manage custom data tables. Store, query, and manipulate structured data within workflows.',
  docsLink: 'https://docs.sim.ai/tools/table',
  category: 'blocks',
  bgColor: '#10B981',
  icon: TableIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Query Rows', id: 'queryRows' },
        { label: 'Insert Row', id: 'insertRow' },
        { label: 'Upsert Row', id: 'upsertRow' },
        { label: 'Batch Insert Rows', id: 'batchInsertRows' },
        { label: 'Update Rows by Filter', id: 'updateRowsByFilter' },
        { label: 'Delete Rows by Filter', id: 'deleteRowsByFilter' },
        { label: 'Update Row by ID', id: 'updateRow' },
        { label: 'Delete Row by ID', id: 'deleteRow' },
        { label: 'Get Row by ID', id: 'getRow' },
        { label: 'Get Schema', id: 'getSchema' },
      ],
      value: () => 'queryRows',
    },

    // Table selector (for all operations)
    {
      id: 'tableId',
      title: 'Table',
      type: 'dropdown',
      placeholder: 'Select a table',
      required: true,
      options: [],
      fetchOptions: async () => {
        const { useWorkflowRegistry } = await import('@/stores/workflows/registry/store')

        const workspaceId = useWorkflowRegistry.getState().hydration.workspaceId
        if (!workspaceId) {
          return []
        }

        try {
          const response = await fetch(`/api/table?workspaceId=${workspaceId}`)
          if (!response.ok) {
            return []
          }

          const data = await response.json()
          return (data.tables || []).map((table: any) => ({
            label: table.name,
            id: table.id,
          }))
        } catch (error) {
          return []
        }
      },
      fetchOptionById: async (_blockId: string, _subBlockId: string, tableId: string) => {
        const { useWorkflowRegistry } = await import('@/stores/workflows/registry/store')

        const workspaceId = useWorkflowRegistry.getState().hydration.workspaceId
        if (!workspaceId) {
          return null
        }

        try {
          const response = await fetch(`/api/table?workspaceId=${workspaceId}`)
          if (!response.ok) {
            return null
          }

          const data = await response.json()
          const table = (data.tables || []).find((t: any) => t.id === tableId)
          return table ? { label: table.name, id: table.id } : null
        } catch (error) {
          return null
        }
      },
    },

    // Row ID for get/update/delete
    {
      id: 'rowId',
      title: 'Row ID',
      type: 'short-input',
      placeholder: 'row_xxxxx',
      condition: { field: 'operation', value: ['getRow', 'updateRow', 'deleteRow'] },
      required: true,
    },

    // Insert/Update/Upsert Row data (single row)
    {
      id: 'rowData',
      title: 'Row Data (JSON)',
      type: 'code',
      placeholder: '{"column_name": "value"}',
      condition: {
        field: 'operation',
        value: ['insertRow', 'upsertRow', 'updateRow', 'updateRowsByFilter'],
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

Table with columns: customer_id (string), total (number), status (string)
"order with customer ID 123, total 99.99, status pending"
→ {"customer_id": "123", "total": 99.99, "status": "pending"}

Return ONLY the data JSON:`,
        generationType: 'json-object',
      },
    },

    // Batch Insert - multiple rows
    {
      id: 'batchRows',
      title: 'Rows Data (Array of JSON)',
      type: 'code',
      placeholder: '[{"col1": "val1"}, {"col1": "val2"}]',
      condition: { field: 'operation', value: 'batchInsertRows' },
      required: true,
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `Generate an array of row data objects matching the table's column schema.

### CONTEXT
{context}

### INSTRUCTION
Return ONLY a valid JSON array of objects. Each object represents one row. No explanations or markdown.
Maximum 1000 rows per batch.

IMPORTANT: Reference the table schema to know which columns exist and their types.

### EXAMPLES

Table with columns: email (string), name (string), age (number)
"3 users: john@example.com age 25, jane@example.com age 30, bob@example.com age 28"
→ [
  {"email": "john@example.com", "name": "John", "age": 25},
  {"email": "jane@example.com", "name": "Jane", "age": 30},
  {"email": "bob@example.com", "name": "Bob", "age": 28}
]

Return ONLY the rows array:`,
        generationType: 'json-object',
      },
    },

    // Filter mode selector for bulk operations
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
        value: ['updateRowsByFilter', 'deleteRowsByFilter'],
      },
    },

    // Filter builder for bulk operations (visual)
    {
      id: 'bulkFilterBuilder',
      title: 'Filter Conditions',
      type: 'filter-format',
      required: {
        field: 'operation',
        value: ['updateRowsByFilter', 'deleteRowsByFilter'],
      },
      condition: {
        field: 'operation',
        value: ['updateRowsByFilter', 'deleteRowsByFilter'],
        and: { field: 'bulkFilterMode', value: 'builder' },
      },
    },

    // Filter for update/delete operations (JSON editor)
    {
      id: 'filterCriteria',
      title: 'Filter Criteria',
      type: 'code',
      placeholder: '{"column_name": {"$eq": "value"}}',
      condition: {
        field: 'operation',
        value: ['updateRowsByFilter', 'deleteRowsByFilter'],
        and: { field: 'bulkFilterMode', value: 'json' },
      },
      required: {
        field: 'operation',
        value: ['updateRowsByFilter', 'deleteRowsByFilter'],
        and: { field: 'bulkFilterMode', value: 'json' },
      },
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `Generate filter criteria for selecting rows to update or delete.

### CONTEXT
{context}

### INSTRUCTION
Return ONLY a valid JSON filter object. No explanations or markdown.

IMPORTANT: Reference the table schema to know which columns exist and their types.

### OPERATORS
- **$eq**: Equals - {"column": {"$eq": "value"}} or {"column": "value"}
- **$ne**: Not equals - {"column": {"$ne": "value"}}
- **$gt**: Greater than - {"column": {"$gt": 18}}
- **$gte**: Greater than or equal - {"column": {"$gte": 100}}
- **$lt**: Less than - {"column": {"$lt": 90}}
- **$lte**: Less than or equal - {"column": {"$lte": 5}}
- **$in**: In array - {"column": {"$in": ["value1", "value2"]}}
- **$nin**: Not in array - {"column": {"$nin": ["value1", "value2"]}}
- **$contains**: String contains - {"column": {"$contains": "text"}}

### EXAMPLES

"rows where status is active"
→ {"status": "active"}

"rows where age is over 18 and status is pending"
→ {"age": {"$gte": 18}, "status": "pending"}

"rows where email contains gmail.com"
→ {"email": {"$contains": "gmail.com"}}

Return ONLY the filter JSON:`,
        generationType: 'json-object',
      },
    },

    // Safety limit for bulk operations
    {
      id: 'bulkLimit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '100',
      condition: {
        field: 'operation',
        value: ['updateRowsByFilter', 'deleteRowsByFilter'],
      },
    },

    // Builder mode selector for queryRows (controls both filter and sort)
    {
      id: 'builderMode',
      title: 'Input Mode',
      type: 'dropdown',
      options: [
        { label: 'Builder', id: 'builder' },
        { label: 'Editor', id: 'json' },
      ],
      value: () => 'builder',
      condition: { field: 'operation', value: 'queryRows' },
    },

    // Filter builder (visual)
    {
      id: 'filterBuilder',
      title: 'Filter Conditions',
      type: 'filter-format',
      condition: {
        field: 'operation',
        value: 'queryRows',
        and: { field: 'builderMode', value: 'builder' },
      },
    },

    // Sort builder (visual)
    {
      id: 'sortBuilder',
      title: 'Sort Order',
      type: 'sort-format',
      condition: {
        field: 'operation',
        value: 'queryRows',
        and: { field: 'builderMode', value: 'builder' },
      },
    },

    // Query filters (JSON editor)
    {
      id: 'filter',
      title: 'Filter',
      type: 'code',
      placeholder: '{"column_name": {"$eq": "value"}}',
      condition: {
        field: 'operation',
        value: 'queryRows',
        and: { field: 'builderMode', value: 'json' },
      },
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `Generate query filters for table data using MongoDB-style operators.

### CONTEXT
{context}

### INSTRUCTION
Return ONLY a valid JSON filter object based on the table's columns. No explanations or markdown.

IMPORTANT: Reference the table schema to know which columns exist and their types (string, number, boolean, date, json).

### OPERATORS
- **$eq**: Equals - {"column": {"$eq": "value"}} or {"column": "value"}
- **$ne**: Not equals - {"column": {"$ne": "value"}}
- **$gt**: Greater than - {"column": {"$gt": 18}} (numbers/dates only)
- **$gte**: Greater than or equal - {"column": {"$gte": 100}} (numbers/dates only)
- **$lt**: Less than - {"column": {"$lt": 90}} (numbers/dates only)
- **$lte**: Less than or equal - {"column": {"$lte": 5}} (numbers/dates only)
- **$in**: In array - {"column": {"$in": ["value1", "value2"]}}
- **$nin**: Not in array - {"column": {"$nin": ["value1", "value2"]}}
- **$contains**: String contains (case-insensitive) - {"column": {"$contains": "text"}} (strings only)

### EXAMPLES

Table with columns: status (string), age (number), email (string), active (boolean)

"active users"
→ {"active": true}

"users over 18 years old"
→ {"age": {"$gte": 18}}

"users with status active or pending"
→ {"status": {"$in": ["active", "pending"]}}

"users with age between 18 and 65 and active status"
→ {"age": {"$gte": 18, "$lte": 65}, "active": true}

"users with email containing 'example.com'"
→ {"email": {"$contains": "example.com"}}

Return ONLY the filter JSON:`,
        generationType: 'json-object',
      },
    },

    // Sort (JSON editor)
    {
      id: 'sort',
      title: 'Sort',
      type: 'code',
      placeholder: '{"column_name": "desc"}',
      condition: {
        field: 'operation',
        value: 'queryRows',
        and: { field: 'builderMode', value: 'json' },
      },
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `Generate sort order for table query results.

### CONTEXT
{context}

### INSTRUCTION
Return ONLY a valid JSON object specifying sort order. No explanations or markdown.

IMPORTANT: Reference the table schema to know which columns exist. You can sort by any column or the built-in columns (createdAt, updatedAt).

### FORMAT
{"column_name": "asc" or "desc"}

You can specify multiple columns for multi-level sorting.

### EXAMPLES

Table with columns: name (string), age (number), email (string), createdAt (date)

"sort by newest first"
→ {"createdAt": "desc"}

"sort by name alphabetically"
→ {"name": "asc"}

"sort by age descending"
→ {"age": "desc"}

"sort by age descending, then name ascending"
→ {"age": "desc", "name": "asc"}

"sort by oldest created first"
→ {"createdAt": "asc"}

Return ONLY the sort JSON:`,
        generationType: 'json-object',
      },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '100',
      condition: { field: 'operation', value: 'queryRows' },
      value: () => '100',
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: 'queryRows' },
      value: () => '0',
    },
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
      'table_query_rows',
      'table_get_row',
      'table_get_schema',
    ],
    config: {
      tool: (params) => {
        const toolMap: Record<string, string> = {
          insertRow: 'table_insert_row',
          batchInsertRows: 'table_batch_insert_rows',
          upsertRow: 'table_upsert_row',
          updateRow: 'table_update_row',
          updateRowsByFilter: 'table_update_rows_by_filter',
          deleteRow: 'table_delete_row',
          deleteRowsByFilter: 'table_delete_rows_by_filter',
          queryRows: 'table_query_rows',
          getRow: 'table_get_row',
          getSchema: 'table_get_schema',
        }
        return toolMap[params.operation] || 'table_query_rows'
      },
      params: (params) => {
        const { operation, ...rest } = params

        /**
         * Helper to parse JSON with better error messages.
         * Also handles common issues with block references in JSON.
         */
        const parseJSON = (value: string | any, fieldName: string): any => {
          if (typeof value !== 'string') return value

          try {
            return JSON.parse(value)
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error)

            // Check if the error might be due to unquoted string values (common when block references are resolved)
            // This happens when users write {"field": <ref>} instead of {"field": "<ref>"}
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

        // Insert Row
        if (operation === 'insertRow') {
          const data = parseJSON(rest.rowData, 'Row Data')
          return {
            tableId: rest.tableId,
            data,
          }
        }

        // Upsert Row
        if (operation === 'upsertRow') {
          const data = parseJSON(rest.rowData, 'Row Data')
          return {
            tableId: rest.tableId,
            data,
          }
        }

        // Batch Insert Rows
        if (operation === 'batchInsertRows') {
          const rows = parseJSON(rest.batchRows, 'Rows Data')
          return {
            tableId: rest.tableId,
            rows,
          }
        }

        // Update Row by ID
        if (operation === 'updateRow') {
          const data = parseJSON(rest.rowData, 'Row Data')
          return {
            tableId: rest.tableId,
            rowId: rest.rowId,
            data,
          }
        }

        // Update Rows by Filter
        if (operation === 'updateRowsByFilter') {
          let filter: any
          if (rest.bulkFilterMode === 'builder' && rest.bulkFilterBuilder) {
            filter = conditionsToFilter(rest.bulkFilterBuilder as any) || undefined
          } else if (rest.filterCriteria) {
            filter = parseJSON(rest.filterCriteria, 'Filter Criteria')
          }
          const data = parseJSON(rest.rowData, 'Row Data')
          return {
            tableId: rest.tableId,
            filter,
            data,
            limit: rest.bulkLimit ? Number.parseInt(rest.bulkLimit as string) : undefined,
          }
        }

        // Delete Row by ID
        if (operation === 'deleteRow') {
          return {
            tableId: rest.tableId,
            rowId: rest.rowId,
          }
        }

        // Delete Rows by Filter
        if (operation === 'deleteRowsByFilter') {
          let filter: any
          if (rest.bulkFilterMode === 'builder' && rest.bulkFilterBuilder) {
            filter = conditionsToFilter(rest.bulkFilterBuilder as any) || undefined
          } else if (rest.filterCriteria) {
            filter = parseJSON(rest.filterCriteria, 'Filter Criteria')
          }
          return {
            tableId: rest.tableId,
            filter,
            limit: rest.bulkLimit ? Number.parseInt(rest.bulkLimit as string) : undefined,
          }
        }

        // Get Row by ID
        if (operation === 'getRow') {
          return {
            tableId: rest.tableId,
            rowId: rest.rowId,
          }
        }

        // Get Schema
        if (operation === 'getSchema') {
          return {
            tableId: rest.tableId,
          }
        }

        // Query Rows
        if (operation === 'queryRows') {
          let filter: any
          if (rest.builderMode === 'builder' && rest.filterBuilder) {
            // Convert builder conditions to filter object
            filter = conditionsToFilter(rest.filterBuilder as any) || undefined
          } else if (rest.filter) {
            filter = parseJSON(rest.filter, 'Filter')
          }

          let sort: any
          if (rest.builderMode === 'builder' && rest.sortBuilder) {
            // Convert sort builder conditions to sort object
            sort = sortConditionsToSort(rest.sortBuilder as any) || undefined
          } else if (rest.sort) {
            sort = parseJSON(rest.sort, 'Sort')
          }

          return {
            tableId: rest.tableId,
            filter,
            sort,
            limit: rest.limit ? Number.parseInt(rest.limit as string) : 100,
            offset: rest.offset ? Number.parseInt(rest.offset as string) : 0,
          }
        }

        return rest
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Table operation to perform' },
    tableId: { type: 'string', description: 'Table identifier' },
    rowData: { type: 'json', description: 'Row data for insert/update' },
    batchRows: { type: 'array', description: 'Array of row data for batch insert' },
    rowId: { type: 'string', description: 'Row identifier for ID-based operations' },
    bulkFilterMode: {
      type: 'string',
      description: 'Filter input mode for bulk operations (builder or json)',
    },
    bulkFilterBuilder: {
      type: 'json',
      description: 'Visual filter builder conditions for bulk operations',
    },
    filterCriteria: { type: 'json', description: 'Filter criteria for bulk operations (JSON)' },
    bulkLimit: { type: 'number', description: 'Safety limit for bulk operations' },
    builderMode: {
      type: 'string',
      description: 'Input mode for filter and sort (builder or json)',
    },
    filterBuilder: { type: 'json', description: 'Visual filter builder conditions' },
    filter: { type: 'json', description: 'Query filter conditions (JSON)' },
    sortBuilder: { type: 'json', description: 'Visual sort builder conditions' },
    sort: { type: 'json', description: 'Sort order (JSON)' },
    limit: { type: 'number', description: 'Query result limit' },
    offset: { type: 'number', description: 'Query result offset' },
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    row: {
      type: 'json',
      description: 'Single row data',
      condition: { field: 'operation', value: ['getRow', 'insertRow', 'upsertRow', 'updateRow'] },
    },
    operation: {
      type: 'string',
      description: 'Operation performed (insert or update)',
      condition: { field: 'operation', value: 'upsertRow' },
    },
    rows: {
      type: 'array',
      description: 'Array of rows',
      condition: { field: 'operation', value: ['queryRows', 'batchInsertRows'] },
    },
    rowCount: {
      type: 'number',
      description: 'Number of rows returned',
      condition: { field: 'operation', value: 'queryRows' },
    },
    totalCount: {
      type: 'number',
      description: 'Total rows matching filter',
      condition: { field: 'operation', value: 'queryRows' },
    },
    insertedCount: {
      type: 'number',
      description: 'Number of rows inserted',
      condition: { field: 'operation', value: 'batchInsertRows' },
    },
    updatedCount: {
      type: 'number',
      description: 'Number of rows updated',
      condition: { field: 'operation', value: 'updateRowsByFilter' },
    },
    updatedRowIds: {
      type: 'array',
      description: 'IDs of updated rows',
      condition: { field: 'operation', value: 'updateRowsByFilter' },
    },
    deletedCount: {
      type: 'number',
      description: 'Number of rows deleted',
      condition: { field: 'operation', value: ['deleteRow', 'deleteRowsByFilter'] },
    },
    deletedRowIds: {
      type: 'array',
      description: 'IDs of deleted rows',
      condition: { field: 'operation', value: 'deleteRowsByFilter' },
    },
    name: {
      type: 'string',
      description: 'Table name',
      condition: { field: 'operation', value: 'getSchema' },
    },
    columns: {
      type: 'array',
      description: 'Column definitions',
      condition: { field: 'operation', value: 'getSchema' },
    },
    message: { type: 'string', description: 'Operation status message' },
  },
}
