import { z } from 'zod'
import {
  introspectionResponseSchema,
  nonEmptyRecordSchema,
  sqlRowsResponseSchema,
} from '@/lib/api/contracts/tools/databases/shared'
import {
  type ContractBodyInput,
  type ContractJsonResponse,
  defineRouteContract,
} from '@/lib/api/contracts/types'

const secureFlagSchema = z
  .union([z.boolean(), z.string()])
  .transform((value) => (typeof value === 'string' ? value.toLowerCase() === 'true' : value))
  .default(true)

export const clickhouseConnectionBodySchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.coerce.number().int().positive('Port must be a positive integer'),
  database: z.string().min(1, 'Database name is required'),
  username: z.string().min(1, 'Username is required'),
  password: z.string().default(''),
  secure: secureFlagSchema,
})

export const clickhouseQueryBodySchema = clickhouseConnectionBodySchema.extend({
  query: z.string().min(1, 'Query is required'),
})

export const clickhouseExecuteBodySchema = clickhouseQueryBodySchema

export const clickhouseInsertBodySchema = clickhouseConnectionBodySchema.extend({
  table: z.string().min(1, 'Table name is required'),
  data: nonEmptyRecordSchema('Data object cannot be empty'),
})

export const clickhouseUpdateBodySchema = clickhouseConnectionBodySchema.extend({
  table: z.string().min(1, 'Table name is required'),
  data: nonEmptyRecordSchema('Data object cannot be empty'),
  where: z.string().min(1, 'WHERE clause is required'),
})

export const clickhouseDeleteBodySchema = clickhouseConnectionBodySchema.extend({
  table: z.string().min(1, 'Table name is required'),
  where: z.string().min(1, 'WHERE clause is required'),
})

export const clickhouseIntrospectBodySchema = clickhouseConnectionBodySchema

export const clickhouseQueryContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/clickhouse/query',
  body: clickhouseQueryBodySchema,
  response: { mode: 'json', schema: sqlRowsResponseSchema },
})

export const clickhouseExecuteContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/clickhouse/execute',
  body: clickhouseExecuteBodySchema,
  response: { mode: 'json', schema: sqlRowsResponseSchema },
})

export const clickhouseInsertContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/clickhouse/insert',
  body: clickhouseInsertBodySchema,
  response: { mode: 'json', schema: sqlRowsResponseSchema },
})

export const clickhouseUpdateContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/clickhouse/update',
  body: clickhouseUpdateBodySchema,
  response: { mode: 'json', schema: sqlRowsResponseSchema },
})

export const clickhouseDeleteContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/clickhouse/delete',
  body: clickhouseDeleteBodySchema,
  response: { mode: 'json', schema: sqlRowsResponseSchema },
})

export const clickhouseIntrospectContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/clickhouse/introspect',
  body: clickhouseIntrospectBodySchema,
  response: { mode: 'json', schema: introspectionResponseSchema },
})

const clickhouseTableBodySchema = clickhouseConnectionBodySchema.extend({
  table: z.string().min(1, 'Table name is required'),
})

const clickhouseCountResponseSchema = z.object({
  message: z.string(),
  count: z.number(),
})

const clickhouseDdlResponseSchema = z.object({
  message: z.string(),
  ddl: z.string(),
})

export const clickhouseListDatabasesBodySchema = clickhouseConnectionBodySchema
export const clickhouseListTablesBodySchema = clickhouseConnectionBodySchema
export const clickhouseDescribeTableBodySchema = clickhouseTableBodySchema
export const clickhouseShowCreateTableBodySchema = clickhouseTableBodySchema
export const clickhouseCountRowsBodySchema = clickhouseTableBodySchema.extend({
  where: z.string().optional(),
})
export const clickhouseListPartitionsBodySchema = clickhouseTableBodySchema
export const clickhouseListMutationsBodySchema = clickhouseConnectionBodySchema.extend({
  table: z.string().optional(),
  onlyRunning: z
    .union([z.boolean(), z.string()])
    .transform((value) => (typeof value === 'string' ? value.toLowerCase() === 'true' : value))
    .default(false),
})
export const clickhouseListRunningQueriesBodySchema = clickhouseConnectionBodySchema
export const clickhouseTableStatsBodySchema = clickhouseConnectionBodySchema.extend({
  table: z.string().optional(),
})
export const clickhouseListClustersBodySchema = clickhouseConnectionBodySchema
export const clickhouseCreateDatabaseBodySchema = clickhouseConnectionBodySchema.extend({
  name: z.string().min(1, 'Database name is required'),
})
export const clickhouseDropDatabaseBodySchema = clickhouseConnectionBodySchema.extend({
  name: z.string().min(1, 'Database name is required'),
})
export const clickhouseCreateTableBodySchema = clickhouseConnectionBodySchema.extend({
  table: z.string().min(1, 'Table name is required'),
  columns: z
    .array(
      z.object({
        name: z.string().min(1, 'Column name is required'),
        type: z.string().min(1, 'Column type is required'),
      })
    )
    .min(1, 'At least one column is required'),
  engine: z.string().min(1).default('MergeTree'),
  orderBy: z.string().min(1, 'ORDER BY expression is required'),
  partitionBy: z.string().optional(),
})
export const clickhouseDropTableBodySchema = clickhouseTableBodySchema
export const clickhouseTruncateTableBodySchema = clickhouseTableBodySchema
export const clickhouseRenameTableBodySchema = clickhouseTableBodySchema.extend({
  newTable: z.string().min(1, 'New table name is required'),
})
export const clickhouseOptimizeTableBodySchema = clickhouseTableBodySchema.extend({
  final: z
    .union([z.boolean(), z.string()])
    .transform((value) => (typeof value === 'string' ? value.toLowerCase() === 'true' : value))
    .default(false),
})
export const clickhouseDropPartitionBodySchema = clickhouseTableBodySchema.extend({
  partition: z.string().min(1, 'Partition expression is required'),
})
export const clickhouseKillQueryBodySchema = clickhouseConnectionBodySchema.extend({
  queryId: z.string().min(1, 'Query ID is required'),
})
export const clickhouseInsertRowsBodySchema = clickhouseTableBodySchema.extend({
  rows: z.array(z.record(z.string(), z.unknown())).min(1, 'At least one row is required'),
})

export const clickhouseListDatabasesContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/clickhouse/list-databases',
  body: clickhouseListDatabasesBodySchema,
  response: { mode: 'json', schema: sqlRowsResponseSchema },
})

export const clickhouseListTablesContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/clickhouse/list-tables',
  body: clickhouseListTablesBodySchema,
  response: { mode: 'json', schema: sqlRowsResponseSchema },
})

export const clickhouseDescribeTableContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/clickhouse/describe-table',
  body: clickhouseDescribeTableBodySchema,
  response: { mode: 'json', schema: sqlRowsResponseSchema },
})

export const clickhouseShowCreateTableContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/clickhouse/show-create-table',
  body: clickhouseShowCreateTableBodySchema,
  response: { mode: 'json', schema: clickhouseDdlResponseSchema },
})

export const clickhouseCountRowsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/clickhouse/count-rows',
  body: clickhouseCountRowsBodySchema,
  response: { mode: 'json', schema: clickhouseCountResponseSchema },
})

export const clickhouseListPartitionsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/clickhouse/list-partitions',
  body: clickhouseListPartitionsBodySchema,
  response: { mode: 'json', schema: sqlRowsResponseSchema },
})

export const clickhouseListMutationsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/clickhouse/list-mutations',
  body: clickhouseListMutationsBodySchema,
  response: { mode: 'json', schema: sqlRowsResponseSchema },
})

export const clickhouseListRunningQueriesContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/clickhouse/list-running-queries',
  body: clickhouseListRunningQueriesBodySchema,
  response: { mode: 'json', schema: sqlRowsResponseSchema },
})

export const clickhouseTableStatsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/clickhouse/table-stats',
  body: clickhouseTableStatsBodySchema,
  response: { mode: 'json', schema: sqlRowsResponseSchema },
})

export const clickhouseListClustersContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/clickhouse/list-clusters',
  body: clickhouseListClustersBodySchema,
  response: { mode: 'json', schema: sqlRowsResponseSchema },
})

export const clickhouseCreateDatabaseContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/clickhouse/create-database',
  body: clickhouseCreateDatabaseBodySchema,
  response: { mode: 'json', schema: sqlRowsResponseSchema },
})

export const clickhouseDropDatabaseContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/clickhouse/drop-database',
  body: clickhouseDropDatabaseBodySchema,
  response: { mode: 'json', schema: sqlRowsResponseSchema },
})

export const clickhouseCreateTableContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/clickhouse/create-table',
  body: clickhouseCreateTableBodySchema,
  response: { mode: 'json', schema: sqlRowsResponseSchema },
})

export const clickhouseDropTableContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/clickhouse/drop-table',
  body: clickhouseDropTableBodySchema,
  response: { mode: 'json', schema: sqlRowsResponseSchema },
})

export const clickhouseTruncateTableContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/clickhouse/truncate-table',
  body: clickhouseTruncateTableBodySchema,
  response: { mode: 'json', schema: sqlRowsResponseSchema },
})

export const clickhouseRenameTableContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/clickhouse/rename-table',
  body: clickhouseRenameTableBodySchema,
  response: { mode: 'json', schema: sqlRowsResponseSchema },
})

export const clickhouseOptimizeTableContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/clickhouse/optimize-table',
  body: clickhouseOptimizeTableBodySchema,
  response: { mode: 'json', schema: sqlRowsResponseSchema },
})

export const clickhouseDropPartitionContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/clickhouse/drop-partition',
  body: clickhouseDropPartitionBodySchema,
  response: { mode: 'json', schema: sqlRowsResponseSchema },
})

export const clickhouseKillQueryContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/clickhouse/kill-query',
  body: clickhouseKillQueryBodySchema,
  response: { mode: 'json', schema: sqlRowsResponseSchema },
})

export const clickhouseInsertRowsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/clickhouse/insert-rows',
  body: clickhouseInsertRowsBodySchema,
  response: { mode: 'json', schema: sqlRowsResponseSchema },
})

export type ClickHouseQueryRequest = ContractBodyInput<typeof clickhouseQueryContract>
export type ClickHouseQueryResponse = ContractJsonResponse<typeof clickhouseQueryContract>
export type ClickHouseExecuteRequest = ContractBodyInput<typeof clickhouseExecuteContract>
export type ClickHouseExecuteResponse = ContractJsonResponse<typeof clickhouseExecuteContract>
export type ClickHouseInsertRequest = ContractBodyInput<typeof clickhouseInsertContract>
export type ClickHouseInsertResponse = ContractJsonResponse<typeof clickhouseInsertContract>
export type ClickHouseUpdateRequest = ContractBodyInput<typeof clickhouseUpdateContract>
export type ClickHouseUpdateResponse = ContractJsonResponse<typeof clickhouseUpdateContract>
export type ClickHouseDeleteRequest = ContractBodyInput<typeof clickhouseDeleteContract>
export type ClickHouseDeleteResponse = ContractJsonResponse<typeof clickhouseDeleteContract>
export type ClickHouseIntrospectRequest = ContractBodyInput<typeof clickhouseIntrospectContract>
export type ClickHouseIntrospectResponse = ContractJsonResponse<typeof clickhouseIntrospectContract>
