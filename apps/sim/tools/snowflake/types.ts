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

/**
 * Warehouse sizes Snowflake accepts as bare keywords. The hyphenated aliases
 * (`'X-SMALL'`, `'2X-LARGE'`, …) name the same sizes but must be quoted, so
 * only the keyword spellings are offered — one accepted form, no quoting rule
 * for the caller to get wrong.
 *
 * @see https://docs.snowflake.com/en/sql-reference/sql/alter-warehouse
 */
export const SNOWFLAKE_WAREHOUSE_SIZES = [
  'XSMALL',
  'SMALL',
  'MEDIUM',
  'LARGE',
  'XLARGE',
  'XXLARGE',
  'XXXLARGE',
  'X4LARGE',
  'X5LARGE',
  'X6LARGE',
] as const

export type SnowflakeBindingType = (typeof SNOWFLAKE_BINDING_TYPES)[number]

export interface SnowflakeBinding {
  type: SnowflakeBindingType
  value: string
}

export interface SnowflakeBaseParams {
  /** Id of the selected Snowflake programmatic-access-token credential. */
  oauthCredential: string
  /** Programmatic access token, injected by the executor from the credential. */
  accessToken?: string
  /** Account host, injected by the executor from the credential. */
  domain?: string
}

export interface SnowflakeStatementParams extends SnowflakeBaseParams {
  role?: string
  statementTimeoutSeconds?: number
}

export interface SnowflakeComputeParams extends SnowflakeStatementParams {
  warehouse?: string
}

export interface SnowflakeResultParams extends SnowflakeComputeParams {
  maxRows?: number
}

export interface SnowflakeExecuteSqlParams extends SnowflakeResultParams {
  database?: string
  schema?: string
  statement: string
  bindings?: Record<string, SnowflakeBinding>
  async?: boolean
}

export interface SnowflakeGetStatementParams extends SnowflakeBaseParams {
  statementHandle: string
  partition?: number
  /**
   * Total partition count reported by the first partition. Snowflake omits all
   * metadata from later partition responses, so continuation is only knowable
   * when this is carried forward from the partition-0 result.
   */
  partitionCount?: number
}

export interface SnowflakeCancelStatementParams extends SnowflakeBaseParams {
  statementHandle: string
}

export interface SnowflakeTableParams extends SnowflakeComputeParams {
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
  maxRows?: number
  stagePath: string
  fileFormat?: string
  pattern?: string
  onError?: string
  purge?: boolean
  force?: boolean
  matchByColumnName?: 'CASE_SENSITIVE' | 'CASE_INSENSITIVE' | 'NONE'
}

export interface SnowflakeUnloadDataParams extends SnowflakeResultParams {
  database: string
  schema: string
  stagePath: string
  /** Source table. An inline query is deliberately not supported — see buildUnloadData. */
  table: string
  fileFormat?: string
  header?: boolean
  overwrite?: boolean
  singleFile?: boolean
  maxFileSizeBytes?: number
}

export interface SnowflakeListDatabasesParams extends SnowflakeStatementParams {
  nameLike?: string
  limit?: number
}

export interface SnowflakeListSchemasParams extends SnowflakeListDatabasesParams {
  database: string
}

export interface SnowflakeListTablesParams extends SnowflakeListSchemasParams {
  schema: string
}

export interface SnowflakeListQueryHistoryParams extends SnowflakeComputeParams {
  userName?: string
  warehouseName?: string
  startTime?: string
  endTime?: string
  errorOnly?: boolean
  limit?: number
}

export interface SnowflakeListCopyHistoryParams extends SnowflakeComputeParams {
  database: string
  schema: string
  table: string
  startTime: string
  endTime?: string
  limit?: number
}

export interface SnowflakeListWarehousesParams extends SnowflakeStatementParams {
  maxRows?: number
  nameLike?: string
}

export interface SnowflakeWarehouseParams extends SnowflakeStatementParams {
  warehouseName: string
}

export interface SnowflakeAlterWarehouseParams extends SnowflakeWarehouseParams {
  warehouseSize?: string
  autoSuspendSeconds?: number
  autoResume?: boolean
}

export interface SnowflakeListTasksParams extends SnowflakeStatementParams {
  database: string
  schema: string
  nameLike?: string
  limit?: number
}

export interface SnowflakeTaskParams extends SnowflakeStatementParams {
  database: string
  schema: string
  taskName: string
}

export interface SnowflakeRunTaskParams extends SnowflakeTaskParams {
  retryLast?: boolean
}

export interface SnowflakeListTaskRunsParams extends SnowflakeComputeParams {
  taskName?: string
  startTime?: string
  endTime?: string
  errorOnly?: boolean
  limit?: number
}

export interface SnowflakeGetTaskRunParams extends SnowflakeComputeParams {
  queryId: string
  taskName?: string
  startTime?: string
  endTime?: string
}

export interface SnowflakeGetTaskRunOutputParams extends SnowflakeResultParams {
  queryId: string
}

export interface SnowflakeCancelTaskRunParams extends SnowflakeComputeParams {
  queryId: string
}

export interface SnowflakeIntrospectSchemaParams extends SnowflakeResultParams {
  database: string
  schema?: string
  table?: string
  includeViews?: boolean
}

export interface SnowflakeCallProcedureParams extends SnowflakeResultParams {
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

export type SnowflakeStatementStatus = 'SUCCEEDED' | 'RUNNING' | 'CANCELED'

export interface SnowflakeResultOutput {
  /**
   * Result column metadata, or null when it is unknown because Snowflake sent a
   * metadata-less partition response.
   */
  columns: SnowflakeColumn[] | null
  rows: Array<Array<string | null>>
  totalRows: number | null
  currentPartition: number
  /**
   * Total number of partitions in the result set, or null when unknown.
   * Snowflake reports this only on the first partition.
   */
  partitionCount: number | null
  nextPartition: number | null
  /**
   * True when more result partitions remain, false when the result set is
   * complete, and null when Snowflake sent a metadata-less partition response
   * and the total partition count was not supplied by the caller. Snowflake
   * reports no signal for a `rows_per_resultset` cap, so a server-side row cap
   * is never reflected here.
   */
  truncated: boolean | null
}

export interface SnowflakeDmlStats {
  rowsInserted: number
  rowsUpdated: number
  rowsDeleted: number
  duplicateRowsUpdated: number
  rowsAffected: number
}

export interface SnowflakeStatementOutput {
  statementHandle: string
  status: SnowflakeStatementStatus
  message: string | null
  result: SnowflakeResultOutput | null
  dml: SnowflakeDmlStats | null
}

export interface SnowflakeStatementResponse extends ToolResponse {
  output: SnowflakeStatementOutput
}

export const SNOWFLAKE_STATEMENT_OUTPUTS = {
  statementHandle: { type: 'string', description: 'Snowflake statement handle' },
  status: { type: 'string', description: 'Statement status: SUCCEEDED, RUNNING, or CANCELED' },
  message: { type: 'string', description: 'Snowflake response message', nullable: true },
  result: {
    type: 'object',
    description: 'Completed result partition, or null while running or when no result is available',
    nullable: true,
    properties: {
      columns: {
        type: 'array',
        description:
          'Documented Snowflake result column metadata, or null when Snowflake returned a metadata-less partition response',
        nullable: true,
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
        description: 'One complete Snowflake result partition as string or null arrays',
        items: { type: 'array', description: 'A result row in column order' },
      },
      totalRows: { type: 'number', description: 'Total result rows', nullable: true },
      currentPartition: { type: 'number', description: 'Zero-based partition returned' },
      partitionCount: {
        type: 'number',
        description:
          'Total partitions in the result set. Snowflake reports this only on the first partition, so pass it back to Get Statement when fetching later partitions',
        nullable: true,
      },
      nextPartition: {
        type: 'number',
        description: 'Next partition to request with Get Statement, if one exists',
        nullable: true,
      },
      truncated: {
        type: 'boolean',
        description:
          'Whether more result partitions remain to fetch with Get Statement, or null when Snowflake returned a metadata-less partition response and partitionCount was not supplied. Snowflake does not report when the requested row limit capped the result set, so that cap is never reflected here',
        nullable: true,
      },
    },
  },
  dml: {
    type: 'object',
    description: 'Completed DML statistics, or null when the statement has no DML statistics',
    nullable: true,
    properties: {
      rowsInserted: { type: 'number', description: 'Rows inserted by the statement' },
      rowsUpdated: { type: 'number', description: 'Rows updated by the statement' },
      rowsDeleted: { type: 'number', description: 'Rows deleted by the statement' },
      duplicateRowsUpdated: {
        type: 'number',
        description: 'Duplicate rows updated by the statement',
      },
      rowsAffected: {
        type: 'number',
        description: 'Total inserted, updated, and deleted rows',
      },
    },
  },
} satisfies Record<string, OutputProperty>
