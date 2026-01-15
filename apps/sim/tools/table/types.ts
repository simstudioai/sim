import type { ToolResponse } from '@/tools/types'

// Re-export shared types from lib/table for convenience
export type {
  ColumnDefinition,
  ColumnType,
  ColumnValue,
  FilterOperators,
  JsonValue,
  QueryFilter,
  RowData,
  TableDefinition,
  TableRow,
  TableSchema,
} from '@/lib/table/types'

// Import types for use in this file
import type {
  ColumnDefinition,
  QueryFilter,
  RowData,
  TableDefinition,
  TableRow,
  TableSchema,
} from '@/lib/table/types'

/**
 * Execution context provided by the workflow executor
 */
export interface ExecutionContext {
  workspaceId: string
  workflowId: string
  userId?: string
  executionId?: string
}

/**
 * Base type for tool parameters with execution context
 */
export interface ToolParamsWithContext {
  _context?: ExecutionContext
}

export interface TableCreateParams extends ToolParamsWithContext {
  name: string
  description?: string
  schema: TableSchema
  workspaceId?: string
}

export interface TableListParams extends ToolParamsWithContext {
  workspaceId?: string
}

export interface TableRowInsertParams extends ToolParamsWithContext {
  tableId: string
  data: RowData
  workspaceId?: string
}

export interface TableRowUpdateParams extends ToolParamsWithContext {
  tableId: string
  rowId: string
  data: RowData
  workspaceId?: string
}

export interface TableRowDeleteParams extends ToolParamsWithContext {
  tableId: string
  rowId: string
  workspaceId?: string
}

export interface TableRowQueryParams extends ToolParamsWithContext {
  tableId: string
  filter?: QueryFilter
  sort?: Record<string, 'asc' | 'desc'>
  limit?: number
  offset?: number
  workspaceId?: string
}

export interface TableRowGetParams extends ToolParamsWithContext {
  tableId: string
  rowId: string
  workspaceId?: string
}

export interface TableCreateResponse extends ToolResponse {
  output: {
    table: TableDefinition
    message: string
  }
}

export interface TableListResponse extends ToolResponse {
  output: {
    tables: TableDefinition[]
    totalCount: number
  }
}

export interface TableRowResponse extends ToolResponse {
  output: {
    row: TableRow
    message: string
  }
}

export interface TableQueryResponse extends ToolResponse {
  output: {
    rows: TableRow[]
    rowCount: number
    totalCount: number
    limit: number
    offset: number
  }
}

export interface TableDeleteResponse extends ToolResponse {
  output: {
    deletedCount: number
    message: string
  }
}

export interface TableBatchInsertParams extends ToolParamsWithContext {
  tableId: string
  rows: RowData[]
  workspaceId?: string
}

export interface TableBatchInsertResponse extends ToolResponse {
  output: {
    rows: TableRow[]
    insertedCount: number
    message: string
  }
}

export interface TableUpdateByFilterParams extends ToolParamsWithContext {
  tableId: string
  filter: QueryFilter
  data: RowData
  limit?: number
  workspaceId?: string
}

export interface TableDeleteByFilterParams extends ToolParamsWithContext {
  tableId: string
  filter: QueryFilter
  limit?: number
  workspaceId?: string
}

export interface TableBulkOperationResponse extends ToolResponse {
  output: {
    updatedCount?: number
    deletedCount?: number
    updatedRowIds?: string[]
    deletedRowIds?: string[]
    message: string
  }
}

export interface TableGetSchemaParams extends ToolParamsWithContext {
  tableId: string
  workspaceId?: string
}

export interface TableGetSchemaResponse extends ToolResponse {
  output: {
    name: string
    columns: ColumnDefinition[]
    message: string
  }
}
