import type {
  ColumnDefinition,
  Filter,
  RowData,
  Sort,
  SortSpec,
  TableDefinition,
  TablePredicateInput,
  TableRow,
  TableSchema,
} from '@/lib/table/types'
import type { OutputProperty, ToolResponse, WorkflowToolExecutionContext } from '@/tools/types'

interface TableOperationOutput {
  success: true
}

export interface TableCreateParams {
  name: string
  description?: string
  schema: TableSchema
  _context?: WorkflowToolExecutionContext
}

export interface TableListParams {
  _context?: WorkflowToolExecutionContext
}

export interface TableRowInsertParams {
  tableId: string
  data: RowData
  /** Unique column to match on for upsert; ignored by plain insert */
  conflictTarget?: string
  _context?: WorkflowToolExecutionContext
}

export interface TableRowUpdateParams {
  tableId: string
  rowId: string
  data: RowData
  _context?: WorkflowToolExecutionContext
}

export interface TableRowDeleteParams {
  tableId: string
  rowId: string
  _context?: WorkflowToolExecutionContext
}

export interface TableRowQueryParams {
  tableId: string
  columns?: string[]
  filter?: Filter
  sort?: Sort
  limit?: number
  offset?: number
  _context?: WorkflowToolExecutionContext
}

export interface TableRowGetParams {
  tableId: string
  rowId: string
  _context?: WorkflowToolExecutionContext
}

/** v2 query params: typed predicate/sort objects + opaque cursor (no offset). */
export interface TableRowQueryV2Params {
  tableId: string
  columns?: string[]
  filter?: TablePredicateInput
  order?: SortSpec
  limit?: number
  cursor?: string
  _context?: WorkflowToolExecutionContext
}

export interface TableQueryV2Response extends ToolResponse {
  output: TableOperationOutput & {
    rows: TableRow[]
    rowCount: number
    totalCount: number | null
    limit: number
    nextCursor: string | null
  }
}

export interface TableCreateResponse extends ToolResponse {
  output: TableOperationOutput & {
    table: TableDefinition
    message: string
  }
}

export interface TableListResponse extends ToolResponse {
  output: TableOperationOutput & {
    tables: TableDefinition[]
    totalCount: number
  }
}

export interface TableRowResponse extends ToolResponse {
  output: TableOperationOutput & {
    row: TableRow
    message: string
  }
}

/** A single-row write (insert or update), with the data keys it dropped for naming no column. */
export interface TableRowWriteResponse extends ToolResponse {
  output: TableRowResponse['output'] & { ignoredColumns: string[] }
}

export interface TableQueryResponse extends ToolResponse {
  output: TableOperationOutput & {
    rows: TableRow[]
    rowCount: number
    totalCount: number
    limit: number
    offset: number
    /**
     * Non-null when more rows match past this page — the only reliable end-of-data signal. A page
     * can end early at the response byte budget, so `rowCount < limit` does NOT mean the last page,
     * and advancing an offset by `limit` rather than by `rowCount` skips whatever the cut left out.
     */
    nextCursor: string | null
  }
}

export interface TableDeleteResponse extends ToolResponse {
  output: TableOperationOutput & {
    deletedCount: number
    message: string
  }
}

export interface TableBatchInsertParams {
  tableId: string
  rows: RowData[]
  _context?: WorkflowToolExecutionContext
}

export interface TableBatchInsertResponse extends ToolResponse {
  output: TableOperationOutput & {
    rows: TableRow[]
    insertedCount: number
    message: string
    ignoredColumns: string[]
  }
}

export interface TableUpdateByFilterParams {
  tableId: string
  filter: Filter
  data: RowData
  limit?: number
  _context?: WorkflowToolExecutionContext
}

export interface TableDeleteByFilterParams {
  tableId: string
  filter: Filter
  limit?: number
  _context?: WorkflowToolExecutionContext
}

export interface TableBulkOperationResponse extends ToolResponse {
  output: TableOperationOutput & {
    updatedCount?: number
    deletedCount?: number
    updatedRowIds?: string[]
    deletedRowIds?: string[]
    message: string
  }
}

/** An update by filter, with the data keys it dropped for naming no column. */
export interface TableBulkUpdateResponse extends ToolResponse {
  output: TableBulkOperationResponse['output'] & { ignoredColumns: string[] }
}

export interface TableGetSchemaParams {
  tableId: string
  _context?: WorkflowToolExecutionContext
}

export interface TableGetSchemaResponse extends ToolResponse {
  output: TableOperationOutput & {
    name: string
    columns: ColumnDefinition[]
    columnCount: number
    rowCount: number
    maxRows: number
    message: string
  }
}

export interface TableUpsertResponse extends ToolResponse {
  output: TableOperationOutput & {
    row: TableRow
    operation: 'insert' | 'update'
    message: string
    ignoredColumns: string[]
  }
}

/**
 * The keys of a row write's data that name no column of the table, which the write drops instead
 * of failing. Shared so every row-writing tool declares it identically.
 */
export const IGNORED_COLUMNS_OUTPUT = {
  type: 'array',
  description:
    'Keys of the written data that name no column of the table, which the write dropped. Empty when every key matched a column.',
  items: { type: 'string' },
} satisfies OutputProperty
