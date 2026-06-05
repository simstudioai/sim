import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Output property definitions for ClickHouse introspection and query responses.
 * @see https://clickhouse.com/docs/sql-reference/statements/system
 */

/**
 * Output definition for table column objects from introspection.
 * @see https://clickhouse.com/docs/operations/system-tables/columns
 */
export const CLICKHOUSE_COLUMN_OUTPUT_PROPERTIES = {
  name: { type: 'string', description: 'Column name' },
  type: { type: 'string', description: 'ClickHouse data type (e.g., UInt32, String, DateTime)' },
  defaultKind: {
    type: 'string',
    description: 'Kind of default expression (DEFAULT, MATERIALIZED, ALIAS)',
    optional: true,
  },
  defaultExpression: {
    type: 'string',
    description: 'Default value expression for the column',
    optional: true,
  },
  isInPrimaryKey: { type: 'boolean', description: 'Whether the column is part of the primary key' },
  isInSortingKey: { type: 'boolean', description: 'Whether the column is part of the sorting key' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for table schema objects from introspection.
 * @see https://clickhouse.com/docs/operations/system-tables/tables
 */
export const CLICKHOUSE_TABLE_OUTPUT_PROPERTIES = {
  name: { type: 'string', description: 'Table name' },
  database: { type: 'string', description: 'Database the table belongs to' },
  engine: { type: 'string', description: 'Table engine (e.g., MergeTree, Log)' },
  totalRows: {
    type: 'number',
    description: 'Approximate total number of rows in the table',
    optional: true,
  },
  columns: {
    type: 'array',
    description: 'Table columns',
    items: {
      type: 'object',
      properties: CLICKHOUSE_COLUMN_OUTPUT_PROPERTIES,
    },
  },
} as const satisfies Record<string, OutputProperty>

export interface ClickHouseConnectionConfig {
  host: string
  port: number
  database: string
  username: string
  password: string
  secure: boolean
}

export interface ClickHouseQueryParams extends ClickHouseConnectionConfig {
  query: string
}

export interface ClickHouseExecuteParams extends ClickHouseConnectionConfig {
  query: string
}

export interface ClickHouseInsertParams extends ClickHouseConnectionConfig {
  table: string
  data: Record<string, unknown>
}

export interface ClickHouseUpdateParams extends ClickHouseConnectionConfig {
  table: string
  data: Record<string, unknown>
  where: string
}

export interface ClickHouseDeleteParams extends ClickHouseConnectionConfig {
  table: string
  where: string
}

export interface ClickHouseIntrospectParams extends ClickHouseConnectionConfig {}

export interface ClickHouseRowsResponse extends ToolResponse {
  output: {
    message: string
    rows: unknown[]
    rowCount: number
  }
  error?: string
}

export interface ClickHouseMessageResponse extends ToolResponse {
  output: {
    message: string
  }
  error?: string
}

export interface ClickHouseCountResponse extends ToolResponse {
  output: {
    message: string
    count: number
  }
  error?: string
}

export interface ClickHouseDdlResponse extends ToolResponse {
  output: {
    message: string
    ddl: string
  }
  error?: string
}

export interface ClickHouseListDatabasesParams extends ClickHouseConnectionConfig {}
export interface ClickHouseListTablesParams extends ClickHouseConnectionConfig {}
export interface ClickHouseDescribeTableParams extends ClickHouseConnectionConfig {
  table: string
}
export interface ClickHouseShowCreateTableParams extends ClickHouseConnectionConfig {
  table: string
}
export interface ClickHouseCountRowsParams extends ClickHouseConnectionConfig {
  table: string
  where?: string
}
export interface ClickHouseListPartitionsParams extends ClickHouseConnectionConfig {
  table: string
}
export interface ClickHouseListMutationsParams extends ClickHouseConnectionConfig {
  table?: string
  onlyRunning?: boolean
}
export interface ClickHouseListRunningQueriesParams extends ClickHouseConnectionConfig {}
export interface ClickHouseTableStatsParams extends ClickHouseConnectionConfig {
  table?: string
}
export interface ClickHouseListClustersParams extends ClickHouseConnectionConfig {}
export interface ClickHouseCreateDatabaseParams extends ClickHouseConnectionConfig {
  name: string
}
export interface ClickHouseDropDatabaseParams extends ClickHouseConnectionConfig {
  name: string
}
export interface ClickHouseCreateTableParams extends ClickHouseConnectionConfig {
  table: string
  columns: Array<{ name: string; type: string }>
  engine: string
  orderBy: string
  partitionBy?: string
}
export interface ClickHouseDropTableParams extends ClickHouseConnectionConfig {
  table: string
}
export interface ClickHouseTruncateTableParams extends ClickHouseConnectionConfig {
  table: string
}
export interface ClickHouseRenameTableParams extends ClickHouseConnectionConfig {
  table: string
  newTable: string
}
export interface ClickHouseOptimizeTableParams extends ClickHouseConnectionConfig {
  table: string
  final?: boolean
}
export interface ClickHouseDropPartitionParams extends ClickHouseConnectionConfig {
  table: string
  partition: string
}
export interface ClickHouseKillQueryParams extends ClickHouseConnectionConfig {
  queryId: string
}
export interface ClickHouseInsertRowsParams extends ClickHouseConnectionConfig {
  table: string
  rows: Array<Record<string, unknown>>
}

export interface ClickHouseQueryResponse extends ClickHouseRowsResponse {}
export interface ClickHouseExecuteResponse extends ClickHouseRowsResponse {}
export interface ClickHouseInsertResponse extends ClickHouseRowsResponse {}
export interface ClickHouseUpdateResponse extends ClickHouseRowsResponse {}
export interface ClickHouseDeleteResponse extends ClickHouseRowsResponse {}

interface ClickHouseTableColumn {
  name: string
  type: string
  defaultKind?: string
  defaultExpression?: string
  isInPrimaryKey: boolean
  isInSortingKey: boolean
}

interface ClickHouseTableSchema {
  name: string
  database: string
  engine: string
  totalRows?: number
  columns: ClickHouseTableColumn[]
}

export interface ClickHouseIntrospectResponse extends ToolResponse {
  output: {
    message: string
    tables: ClickHouseTableSchema[]
  }
  error?: string
}

export interface ClickHouseResponse extends ClickHouseRowsResponse {}
