import type { OutputProperty, ToolResponse } from '@/tools/types'

export const SNOWFLAKE_BINDING_TYPES = [
  'FIXED',
  'REAL',
  'DECFLOAT',
  'TEXT',
  'BINARY',
  'BOOLEAN',
  'DATE',
  'TIME',
  'TIMESTAMP_TZ',
  'TIMESTAMP_LTZ',
  'TIMESTAMP_NTZ',
] as const

export const SNOWFLAKE_STATEMENT_OUTPUTS = {
  statementHandle: { type: 'string', description: 'Snowflake statement handle' },
  status: { type: 'string', description: 'Statement status: SUCCEEDED, RUNNING, or CANCELED' },
  code: { type: 'string', description: 'Snowflake response code', nullable: true },
  sqlState: { type: 'string', description: 'SQLSTATE response code', nullable: true },
  message: { type: 'string', description: 'Snowflake status message' },
  columns: {
    type: 'array',
    description: 'Documented Snowflake result column metadata',
    items: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Column name' },
        type: { type: 'string', description: 'Snowflake data type' },
        length: { type: 'number', description: 'Column length', nullable: true },
        precision: { type: 'number', description: 'Numeric precision', nullable: true },
        scale: { type: 'number', description: 'Numeric scale', nullable: true },
        nullable: { type: 'boolean', description: 'Whether the column is nullable' },
      },
    },
  },
  rows: {
    type: 'array',
    description: 'One Snowflake result partition as arrays of string or null column values',
    items: { type: 'array', description: 'A result row in column order' },
  },
  totalRows: { type: 'number', description: 'Total result rows', nullable: true },
  partitions: {
    type: 'array',
    description: 'Available result partitions and their documented sizes',
    items: {
      type: 'object',
      properties: {
        rowCount: { type: 'number', description: 'Rows in the partition' },
        compressedSize: { type: 'number', description: 'Compressed bytes', nullable: true },
        uncompressedSize: { type: 'number', description: 'Uncompressed bytes' },
      },
    },
  },
  currentPartition: { type: 'number', description: 'Zero-based partition returned' },
  nextPartition: {
    type: 'number',
    description: 'Next partition to request, if one exists',
    nullable: true,
  },
  truncated: {
    type: 'boolean',
    description: 'Whether additional rows or partitions remain',
  },
  rowsInserted: { type: 'number', description: 'Rows inserted by a DML statement' },
  rowsUpdated: { type: 'number', description: 'Rows updated by a DML statement' },
  rowsDeleted: { type: 'number', description: 'Rows deleted by a DML statement' },
  duplicateRowsUpdated: {
    type: 'number',
    description: 'Duplicate rows updated by a DML statement',
  },
  rowsAffected: { type: 'number', description: 'Total inserted, updated, and deleted rows' },
} satisfies Record<string, OutputProperty>

export type SnowflakeBindingType = (typeof SNOWFLAKE_BINDING_TYPES)[number]

export interface SnowflakeBinding {
  type: SnowflakeBindingType
  value: string
}

export interface SnowflakeBaseParams {
  host: string
  apiKey: string
}

export interface SnowflakeContextParams extends SnowflakeBaseParams {
  warehouse?: string
  database?: string
  schema?: string
  role?: string
  timeout?: number
  maxRows?: number
}

export interface SnowflakeExecuteSqlParams extends SnowflakeContextParams {
  statement: string
  bindings?: Record<string, SnowflakeBinding>
  async?: boolean
}

export interface SnowflakeGetStatementParams extends SnowflakeBaseParams {
  statementHandle: string
  partition?: number
  maxRows?: number
}

export interface SnowflakeCancelStatementParams extends SnowflakeBaseParams {
  statementHandle: string
}

export interface SnowflakeTableParams extends SnowflakeContextParams {
  database: string
  schema: string
  table: string
}

export interface SnowflakeInsertRowsParams extends SnowflakeTableParams {
  rows: Array<Record<string, unknown>>
}

export interface SnowflakeUpdateRowsParams extends SnowflakeInsertRowsParams {
  matchColumns: string[]
}

export type SnowflakeUpsertRowsParams = SnowflakeUpdateRowsParams

export interface SnowflakeDeleteRowsParams extends SnowflakeTableParams {
  filters: Record<string, unknown>
}

export interface SnowflakeLoadDataParams extends SnowflakeTableParams {
  stagePath: string
  fileFormat?: string
  pattern?: string
  onError?: string
  purge?: boolean
  force?: boolean
  matchByColumnName?: 'CASE_SENSITIVE' | 'CASE_INSENSITIVE' | 'NONE'
}

export interface SnowflakeListWarehousesParams extends SnowflakeContextParams {
  nameLike?: string
}

export interface SnowflakeWarehouseParams extends SnowflakeContextParams {
  warehouseName: string
}

export interface SnowflakeListTasksParams extends SnowflakeContextParams {
  database: string
  schema: string
  nameLike?: string
  limit?: number
}

export interface SnowflakeTaskParams extends SnowflakeContextParams {
  database: string
  schema: string
  taskName: string
}

export interface SnowflakeRunTaskParams extends SnowflakeTaskParams {
  retryLast?: boolean
}

export interface SnowflakeListTaskRunsParams extends SnowflakeContextParams {
  taskName?: string
  startTime?: string
  endTime?: string
  errorOnly?: boolean
  limit?: number
}

export interface SnowflakeTaskRunParams extends SnowflakeContextParams {
  queryId: string
  taskName?: string
  startTime?: string
  endTime?: string
}

export interface SnowflakeIntrospectSchemaParams extends SnowflakeContextParams {
  database: string
  schema?: string
  table?: string
  includeViews?: boolean
}

export interface SnowflakeCallProcedureParams extends SnowflakeContextParams {
  database: string
  schema: string
  procedureName: string
  procedureArguments?: SnowflakeBinding[]
}

export interface SnowflakeColumn {
  name: string
  type: string
  length: number | null
  precision: number | null
  scale: number | null
  nullable: boolean
}

export interface SnowflakePartition {
  rowCount: number
  compressedSize: number | null
  uncompressedSize: number
}

export interface SnowflakeStatementOutput {
  statementHandle: string
  status: 'SUCCEEDED' | 'RUNNING' | 'CANCELED'
  code: string | null
  sqlState: string | null
  message: string
  columns: SnowflakeColumn[]
  rows: Array<Array<string | null>>
  totalRows: number | null
  partitions: SnowflakePartition[]
  currentPartition: number
  nextPartition: number | null
  truncated: boolean
  rowsInserted: number
  rowsUpdated: number
  rowsDeleted: number
  duplicateRowsUpdated: number
  rowsAffected: number
}

export interface SnowflakeStatementResponse extends ToolResponse {
  output: SnowflakeStatementOutput
}

export type SnowflakeExecuteSqlResponse = SnowflakeStatementResponse
export type SnowflakeGetStatementResponse = SnowflakeStatementResponse
export type SnowflakeCancelStatementResponse = SnowflakeStatementResponse
export type SnowflakeInsertRowsResponse = SnowflakeStatementResponse
export type SnowflakeUpdateRowsResponse = SnowflakeStatementResponse
export type SnowflakeUpsertRowsResponse = SnowflakeStatementResponse
export type SnowflakeDeleteRowsResponse = SnowflakeStatementResponse
export type SnowflakeLoadDataResponse = SnowflakeStatementResponse
export type SnowflakeListWarehousesResponse = SnowflakeStatementResponse
export type SnowflakeGetWarehouseResponse = SnowflakeStatementResponse
export type SnowflakeResumeWarehouseResponse = SnowflakeStatementResponse
export type SnowflakeSuspendWarehouseResponse = SnowflakeStatementResponse
export type SnowflakeListTasksResponse = SnowflakeStatementResponse
export type SnowflakeGetTaskResponse = SnowflakeStatementResponse
export type SnowflakeRunTaskResponse = SnowflakeStatementResponse
export type SnowflakeListTaskRunsResponse = SnowflakeStatementResponse
export type SnowflakeGetTaskRunResponse = SnowflakeStatementResponse
export type SnowflakeCancelTaskRunResponse = SnowflakeStatementResponse
export type SnowflakeGetTaskRunOutputResponse = SnowflakeStatementResponse
export type SnowflakeIntrospectSchemaResponse = SnowflakeStatementResponse
export type SnowflakeCallProcedureResponse = SnowflakeStatementResponse
