import { getErrorMessage } from '@sim/utils/errors'
import type { z } from 'zod'
import {
  executeClickHouseCountRows,
  executeClickHouseCreateDatabase,
  executeClickHouseCreateTable,
  executeClickHouseDelete,
  executeClickHouseDescribeTable,
  executeClickHouseDropDatabase,
  executeClickHouseDropPartition,
  executeClickHouseDropTable,
  executeClickHouseInsert,
  executeClickHouseInsertRows,
  executeClickHouseIntrospection,
  executeClickHouseKillQuery,
  executeClickHouseListClusters,
  executeClickHouseListDatabases,
  executeClickHouseListMutations,
  executeClickHouseListPartitions,
  executeClickHouseListRunningQueries,
  executeClickHouseListTables,
  executeClickHouseOptimizeTable,
  executeClickHouseQuery,
  executeClickHouseRenameTable,
  executeClickHouseShowCreateTable,
  executeClickHouseStatement,
  executeClickHouseTableStats,
  executeClickHouseTruncateTable,
  executeClickHouseUpdate,
} from '@/lib/internal/clickhouse/operations'
import {
  clickhouseCountRowsInputSchema,
  clickhouseCreateDatabaseInputSchema,
  clickhouseCreateTableInputSchema,
  clickhouseDeleteInputSchema,
  clickhouseDescribeTableInputSchema,
  clickhouseDropDatabaseInputSchema,
  clickhouseDropPartitionInputSchema,
  clickhouseDropTableInputSchema,
  clickhouseExecuteInputSchema,
  clickhouseInsertInputSchema,
  clickhouseInsertRowsInputSchema,
  clickhouseIntrospectInputSchema,
  clickhouseKillQueryInputSchema,
  clickhouseListClustersInputSchema,
  clickhouseListDatabasesInputSchema,
  clickhouseListMutationsInputSchema,
  clickhouseListPartitionsInputSchema,
  clickhouseListRunningQueriesInputSchema,
  clickhouseListTablesInputSchema,
  clickhouseOptimizeTableInputSchema,
  clickhouseQueryInputSchema,
  clickhouseRenameTableInputSchema,
  clickhouseShowCreateTableInputSchema,
  clickhouseTableStatsInputSchema,
  clickhouseTruncateTableInputSchema,
  clickhouseUpdateInputSchema,
} from '@/lib/internal/clickhouse/schema'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

async function executeOperation<TInput>(
  schema: z.ZodType<TInput>,
  input: unknown,
  execute: (input: TInput, signal?: AbortSignal) => Promise<unknown>,
  errorPrefix: string,
  signal?: AbortSignal
): Promise<Response> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    return Response.json(
      { error: 'Invalid request data', details: parsed.error.issues },
      { status: 400 }
    )
  }

  try {
    const result = await execute(parsed.data, signal)
    signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    signal?.throwIfAborted()
    return Response.json(
      { error: `${errorPrefix}: ${getErrorMessage(error, 'Unknown error occurred')}` },
      { status: 500 }
    )
  }
}

export const executeClickHouseTool: InternalToolOperationHandler = async ({
  toolId,
  input,
  signal,
}) => {
  signal?.throwIfAborted()

  switch (toolId) {
    case 'clickhouse_query':
      return executeOperation(
        clickhouseQueryInputSchema,
        input,
        executeClickHouseQuery,
        'ClickHouse query failed',
        signal
      )
    case 'clickhouse_execute':
      return executeOperation(
        clickhouseExecuteInputSchema,
        input,
        executeClickHouseStatement,
        'ClickHouse execute failed',
        signal
      )
    case 'clickhouse_insert':
      return executeOperation(
        clickhouseInsertInputSchema,
        input,
        executeClickHouseInsert,
        'ClickHouse insert failed',
        signal
      )
    case 'clickhouse_update':
      return executeOperation(
        clickhouseUpdateInputSchema,
        input,
        executeClickHouseUpdate,
        'ClickHouse update failed',
        signal
      )
    case 'clickhouse_delete':
      return executeOperation(
        clickhouseDeleteInputSchema,
        input,
        executeClickHouseDelete,
        'ClickHouse delete failed',
        signal
      )
    case 'clickhouse_introspect':
      return executeOperation(
        clickhouseIntrospectInputSchema,
        input,
        executeClickHouseIntrospection,
        'ClickHouse introspection failed',
        signal
      )
    case 'clickhouse_list_databases':
      return executeOperation(
        clickhouseListDatabasesInputSchema,
        input,
        executeClickHouseListDatabases,
        'ClickHouse list databases failed',
        signal
      )
    case 'clickhouse_list_tables':
      return executeOperation(
        clickhouseListTablesInputSchema,
        input,
        executeClickHouseListTables,
        'ClickHouse list tables failed',
        signal
      )
    case 'clickhouse_describe_table':
      return executeOperation(
        clickhouseDescribeTableInputSchema,
        input,
        executeClickHouseDescribeTable,
        'ClickHouse describe table failed',
        signal
      )
    case 'clickhouse_show_create_table':
      return executeOperation(
        clickhouseShowCreateTableInputSchema,
        input,
        executeClickHouseShowCreateTable,
        'ClickHouse show create table failed',
        signal
      )
    case 'clickhouse_count_rows':
      return executeOperation(
        clickhouseCountRowsInputSchema,
        input,
        executeClickHouseCountRows,
        'ClickHouse count rows failed',
        signal
      )
    case 'clickhouse_list_partitions':
      return executeOperation(
        clickhouseListPartitionsInputSchema,
        input,
        executeClickHouseListPartitions,
        'ClickHouse list partitions failed',
        signal
      )
    case 'clickhouse_list_mutations':
      return executeOperation(
        clickhouseListMutationsInputSchema,
        input,
        executeClickHouseListMutations,
        'ClickHouse list mutations failed',
        signal
      )
    case 'clickhouse_list_running_queries':
      return executeOperation(
        clickhouseListRunningQueriesInputSchema,
        input,
        executeClickHouseListRunningQueries,
        'ClickHouse list running queries failed',
        signal
      )
    case 'clickhouse_table_stats':
      return executeOperation(
        clickhouseTableStatsInputSchema,
        input,
        executeClickHouseTableStats,
        'ClickHouse table stats failed',
        signal
      )
    case 'clickhouse_list_clusters':
      return executeOperation(
        clickhouseListClustersInputSchema,
        input,
        executeClickHouseListClusters,
        'ClickHouse list clusters failed',
        signal
      )
    case 'clickhouse_create_database':
      return executeOperation(
        clickhouseCreateDatabaseInputSchema,
        input,
        executeClickHouseCreateDatabase,
        'ClickHouse create database failed',
        signal
      )
    case 'clickhouse_drop_database':
      return executeOperation(
        clickhouseDropDatabaseInputSchema,
        input,
        executeClickHouseDropDatabase,
        'ClickHouse drop database failed',
        signal
      )
    case 'clickhouse_create_table':
      return executeOperation(
        clickhouseCreateTableInputSchema,
        input,
        executeClickHouseCreateTable,
        'ClickHouse create table failed',
        signal
      )
    case 'clickhouse_drop_table':
      return executeOperation(
        clickhouseDropTableInputSchema,
        input,
        executeClickHouseDropTable,
        'ClickHouse drop table failed',
        signal
      )
    case 'clickhouse_truncate_table':
      return executeOperation(
        clickhouseTruncateTableInputSchema,
        input,
        executeClickHouseTruncateTable,
        'ClickHouse truncate table failed',
        signal
      )
    case 'clickhouse_rename_table':
      return executeOperation(
        clickhouseRenameTableInputSchema,
        input,
        executeClickHouseRenameTable,
        'ClickHouse rename table failed',
        signal
      )
    case 'clickhouse_optimize_table':
      return executeOperation(
        clickhouseOptimizeTableInputSchema,
        input,
        executeClickHouseOptimizeTable,
        'ClickHouse optimize table failed',
        signal
      )
    case 'clickhouse_drop_partition':
      return executeOperation(
        clickhouseDropPartitionInputSchema,
        input,
        executeClickHouseDropPartition,
        'ClickHouse drop partition failed',
        signal
      )
    case 'clickhouse_kill_query':
      return executeOperation(
        clickhouseKillQueryInputSchema,
        input,
        executeClickHouseKillQuery,
        'ClickHouse kill query failed',
        signal
      )
    case 'clickhouse_insert_rows':
      return executeOperation(
        clickhouseInsertRowsInputSchema,
        input,
        executeClickHouseInsertRows,
        'ClickHouse insert rows failed',
        signal
      )
    default:
      return Response.json({ error: `Unsupported ClickHouse tool: ${toolId}` }, { status: 500 })
  }
}
