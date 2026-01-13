import type { ToolResponse } from '@/tools/types'

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

export type ColumnType = 'string' | 'number' | 'boolean' | 'date' | 'json'

export interface ColumnDefinition {
  name: string
  type: ColumnType
  required?: boolean
}

export interface TableSchema {
  columns: ColumnDefinition[]
}

export interface TableDefinition {
  id: string
  name: string
  description?: string
  schema: TableSchema
  rowCount: number
  maxRows: number
  createdAt: string
  updatedAt: string
}

export interface TableRow {
  id: string
  data: Record<string, any>
  createdAt: string
  updatedAt: string
}

export interface QueryFilter {
  [key: string]:
    | any
    | {
        $eq?: any
        $ne?: any
        $gt?: number
        $gte?: number
        $lt?: number
        $lte?: number
        $in?: any[]
        $nin?: any[]
        $contains?: string
      }
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
  data: Record<string, any>
  workspaceId?: string
}

export interface TableRowUpdateParams extends ToolParamsWithContext {
  tableId: string
  rowId: string
  data: Record<string, any>
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
  rows: Record<string, any>[]
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
  data: Record<string, any>
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
