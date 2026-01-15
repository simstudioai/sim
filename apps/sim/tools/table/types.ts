import type {
  ColumnDefinition,
  QueryFilter,
  RowData,
  TableDefinition,
  TableRow,
  TableSchema,
} from '@/lib/table/types'
import type { ToolExecutionContext, ToolResponse } from '@/tools/types'

export interface TableCreateParams {
  name: string
  description?: string
  schema: TableSchema
  _context?: ToolExecutionContext
}

export interface TableListParams {
  _context?: ToolExecutionContext
}

export interface TableRowInsertParams {
  tableId: string
  data: RowData
  _context?: ToolExecutionContext
}

export interface TableRowUpdateParams {
  tableId: string
  rowId: string
  data: RowData
  _context?: ToolExecutionContext
}

export interface TableRowDeleteParams {
  tableId: string
  rowId: string
  _context?: ToolExecutionContext
}

export interface TableRowQueryParams {
  tableId: string
  filter?: QueryFilter
  sort?: Record<string, 'asc' | 'desc'>
  limit?: number
  offset?: number
  _context?: ToolExecutionContext
}

export interface TableRowGetParams {
  tableId: string
  rowId: string
  _context?: ToolExecutionContext
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

export interface TableBatchInsertParams {
  tableId: string
  rows: RowData[]
  _context?: ToolExecutionContext
}

export interface TableBatchInsertResponse extends ToolResponse {
  output: {
    rows: TableRow[]
    insertedCount: number
    message: string
  }
}

export interface TableUpdateByFilterParams {
  tableId: string
  filter: QueryFilter
  data: RowData
  limit?: number
  _context?: ToolExecutionContext
}

export interface TableDeleteByFilterParams {
  tableId: string
  filter: QueryFilter
  limit?: number
  _context?: ToolExecutionContext
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

export interface TableGetSchemaParams {
  tableId: string
  _context?: ToolExecutionContext
}

export interface TableGetSchemaResponse extends ToolResponse {
  output: {
    name: string
    columns: ColumnDefinition[]
    message: string
  }
}
