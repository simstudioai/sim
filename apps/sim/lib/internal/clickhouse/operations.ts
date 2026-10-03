import type {
  ClickhouseCountRowsInput,
  ClickhouseCreateDatabaseInput,
  ClickhouseCreateTableInput,
  ClickhouseDeleteInput,
  ClickhouseDescribeTableInput,
  ClickhouseDropDatabaseInput,
  ClickhouseDropPartitionInput,
  ClickhouseDropTableInput,
  ClickhouseExecuteInput,
  ClickhouseInsertInput,
  ClickhouseInsertRowsInput,
  ClickhouseIntrospectInput,
  ClickhouseKillQueryInput,
  ClickhouseListClustersInput,
  ClickhouseListDatabasesInput,
  ClickhouseListMutationsInput,
  ClickhouseListPartitionsInput,
  ClickhouseListRunningQueriesInput,
  ClickhouseListTablesInput,
  ClickhouseOptimizeTableInput,
  ClickhouseQueryInput,
  ClickhouseRenameTableInput,
  ClickhouseShowCreateTableInput,
  ClickhouseTableStatsInput,
  ClickhouseTruncateTableInput,
  ClickhouseUpdateInput,
} from '@/lib/internal/clickhouse/schema'
import {
  executeClickHouseCountRows as countRows,
  executeClickHouseCreateDatabase as createDatabase,
  executeClickHouseCreateTable as createTable,
  executeClickHouseDelete as deleteRows,
  executeClickHouseDescribeTable as describeTable,
  executeClickHouseDropDatabase as dropDatabase,
  executeClickHouseDropPartition as dropPartition,
  executeClickHouseDropTable as dropTable,
  executeClickHouseQuery as executeQuery,
  executeClickHouseInsert as insertRow,
  executeClickHouseInsertRows as insertRows,
  executeClickHouseIntrospect as introspect,
  executeClickHouseKillQuery as killQuery,
  executeClickHouseListClusters as listClusters,
  executeClickHouseListDatabases as listDatabases,
  executeClickHouseListMutations as listMutations,
  executeClickHouseListPartitions as listPartitions,
  executeClickHouseListRunningQueries as listRunningQueries,
  executeClickHouseListTables as listTables,
  executeClickHouseOptimizeTable as optimizeTable,
  executeClickHouseRenameTable as renameTable,
  executeClickHouseShowCreateTable as showCreateTable,
  executeClickHouseTableStats as tableStats,
  executeClickHouseTruncateTable as truncateTable,
  executeClickHouseUpdate as updateRows,
} from '@/lib/internal/clickhouse/sql'

interface RowsResponse {
  message: string
  rows: unknown[]
  rowCount: number
}

function rowsResponse(message: string, rows: unknown[], rowCount: number): RowsResponse {
  return { message, rows, rowCount }
}

export async function executeClickHouseQuery(
  input: ClickhouseQueryInput,
  signal?: AbortSignal
): Promise<RowsResponse> {
  const result = await executeQuery(input, input.query, { enforceReadOnly: true }, signal)
  return rowsResponse(
    `Query executed successfully. ${result.rowCount} row(s) returned.`,
    result.rows,
    result.rowCount
  )
}

export async function executeClickHouseStatement(
  input: ClickhouseExecuteInput,
  signal?: AbortSignal
): Promise<RowsResponse> {
  const result = await executeQuery(input, input.query, {}, signal)
  return rowsResponse(
    `Statement executed successfully. ${result.rowCount} row(s) returned or affected.`,
    result.rows,
    result.rowCount
  )
}

export async function executeClickHouseInsert(
  input: ClickhouseInsertInput,
  signal?: AbortSignal
): Promise<RowsResponse> {
  const result = await insertRow(input, input.table, input.data, signal)
  return rowsResponse(
    `Data inserted successfully. ${result.rowCount} row(s) affected.`,
    result.rows,
    result.rowCount
  )
}

export async function executeClickHouseUpdate(
  input: ClickhouseUpdateInput,
  signal?: AbortSignal
): Promise<RowsResponse> {
  const result = await updateRows(input, input.table, input.data, input.where, signal)
  return rowsResponse(
    `Update mutation submitted. ClickHouse mutations run asynchronously. ${result.rowCount} row(s) written.`,
    result.rows,
    result.rowCount
  )
}

export async function executeClickHouseDelete(
  input: ClickhouseDeleteInput,
  signal?: AbortSignal
): Promise<RowsResponse> {
  const result = await deleteRows(input, input.table, input.where, signal)
  return rowsResponse(
    `Delete mutation submitted. ClickHouse mutations run asynchronously. ${result.rowCount} row(s) affected.`,
    result.rows,
    result.rowCount
  )
}

export async function executeClickHouseIntrospection(
  input: ClickhouseIntrospectInput,
  signal?: AbortSignal
) {
  const result = await introspect(input, signal)
  return {
    message: `Schema introspection completed. Found ${result.tables.length} table(s) in database '${input.database}'.`,
    tables: result.tables,
  }
}

export async function executeClickHouseListDatabases(
  input: ClickhouseListDatabasesInput,
  signal?: AbortSignal
): Promise<RowsResponse> {
  const result = await listDatabases(input, signal)
  return rowsResponse(`Found ${result.rowCount} database(s).`, result.rows, result.rowCount)
}

export async function executeClickHouseListTables(
  input: ClickhouseListTablesInput,
  signal?: AbortSignal
): Promise<RowsResponse> {
  const result = await listTables(input, signal)
  return rowsResponse(`Found ${result.rowCount} table(s).`, result.rows, result.rowCount)
}

export async function executeClickHouseDescribeTable(
  input: ClickhouseDescribeTableInput,
  signal?: AbortSignal
): Promise<RowsResponse> {
  const result = await describeTable(input, input.table, signal)
  return rowsResponse(
    `Described table with ${result.rowCount} column(s).`,
    result.rows,
    result.rowCount
  )
}

export async function executeClickHouseShowCreateTable(
  input: ClickhouseShowCreateTableInput,
  signal?: AbortSignal
) {
  return {
    message: 'Retrieved CREATE statement.',
    ddl: await showCreateTable(input, input.table, signal),
  }
}

export async function executeClickHouseCountRows(
  input: ClickhouseCountRowsInput,
  signal?: AbortSignal
) {
  const count = await countRows(input, input.table, input.where, signal)
  return { message: `Table contains ${count} row(s).`, count }
}

export async function executeClickHouseListPartitions(
  input: ClickhouseListPartitionsInput,
  signal?: AbortSignal
): Promise<RowsResponse> {
  const result = await listPartitions(input, input.table, signal)
  return rowsResponse(`Found ${result.rowCount} partition(s).`, result.rows, result.rowCount)
}

export async function executeClickHouseListMutations(
  input: ClickhouseListMutationsInput,
  signal?: AbortSignal
): Promise<RowsResponse> {
  const result = await listMutations(input, input.table, input.onlyRunning, signal)
  return rowsResponse(`Found ${result.rowCount} mutation(s).`, result.rows, result.rowCount)
}

export async function executeClickHouseListRunningQueries(
  input: ClickhouseListRunningQueriesInput,
  signal?: AbortSignal
): Promise<RowsResponse> {
  const result = await listRunningQueries(input, signal)
  return rowsResponse(`Found ${result.rowCount} running query(ies).`, result.rows, result.rowCount)
}

export async function executeClickHouseTableStats(
  input: ClickhouseTableStatsInput,
  signal?: AbortSignal
): Promise<RowsResponse> {
  const result = await tableStats(input, input.table, signal)
  return rowsResponse(
    `Retrieved stats for ${result.rowCount} table(s).`,
    result.rows,
    result.rowCount
  )
}

export async function executeClickHouseListClusters(
  input: ClickhouseListClustersInput,
  signal?: AbortSignal
): Promise<RowsResponse> {
  const result = await listClusters(input, signal)
  return rowsResponse(`Found ${result.rowCount} cluster node(s).`, result.rows, result.rowCount)
}

export async function executeClickHouseCreateDatabase(
  input: ClickhouseCreateDatabaseInput,
  signal?: AbortSignal
): Promise<RowsResponse> {
  await createDatabase(input, input.name, signal)
  return rowsResponse(`Database '${input.name}' created.`, [], 0)
}

export async function executeClickHouseDropDatabase(
  input: ClickhouseDropDatabaseInput,
  signal?: AbortSignal
): Promise<RowsResponse> {
  await dropDatabase(input, input.name, signal)
  return rowsResponse(`Database '${input.name}' dropped.`, [], 0)
}

export async function executeClickHouseCreateTable(
  input: ClickhouseCreateTableInput,
  signal?: AbortSignal
): Promise<RowsResponse> {
  await createTable(
    input,
    input.table,
    input.columns,
    input.engine,
    input.orderBy,
    input.partitionBy,
    signal
  )
  return rowsResponse(`Table '${input.table}' created.`, [], 0)
}

export async function executeClickHouseDropTable(
  input: ClickhouseDropTableInput,
  signal?: AbortSignal
): Promise<RowsResponse> {
  await dropTable(input, input.table, signal)
  return rowsResponse(`Table '${input.table}' dropped.`, [], 0)
}

export async function executeClickHouseTruncateTable(
  input: ClickhouseTruncateTableInput,
  signal?: AbortSignal
): Promise<RowsResponse> {
  await truncateTable(input, input.table, signal)
  return rowsResponse(`Table '${input.table}' truncated.`, [], 0)
}

export async function executeClickHouseRenameTable(
  input: ClickhouseRenameTableInput,
  signal?: AbortSignal
): Promise<RowsResponse> {
  await renameTable(input, input.table, input.newTable, signal)
  return rowsResponse(`Renamed table '${input.table}' to '${input.newTable}'.`, [], 0)
}

export async function executeClickHouseOptimizeTable(
  input: ClickhouseOptimizeTableInput,
  signal?: AbortSignal
): Promise<RowsResponse> {
  await optimizeTable(input, input.table, input.final, signal)
  return rowsResponse(`Optimize submitted for table '${input.table}'.`, [], 0)
}

export async function executeClickHouseDropPartition(
  input: ClickhouseDropPartitionInput,
  signal?: AbortSignal
): Promise<RowsResponse> {
  await dropPartition(input, input.table, input.partition, signal)
  return rowsResponse(`Dropped partition from table '${input.table}'.`, [], 0)
}

export async function executeClickHouseKillQuery(
  input: ClickhouseKillQueryInput,
  signal?: AbortSignal
): Promise<RowsResponse> {
  const result = await killQuery(input, input.queryId, signal)
  return rowsResponse(
    `Kill command executed for query '${input.queryId}'.`,
    result.rows,
    result.rowCount
  )
}

export async function executeClickHouseInsertRows(
  input: ClickhouseInsertRowsInput,
  signal?: AbortSignal
): Promise<RowsResponse> {
  const result = await insertRows(input, input.table, input.rows, signal)
  return rowsResponse(
    `Inserted ${result.rowCount} row(s) into '${input.table}'.`,
    result.rows,
    result.rowCount
  )
}
