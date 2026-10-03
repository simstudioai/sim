import {
  type AthenaClient,
  BatchGetNamedQueryCommand,
  BatchGetPreparedStatementCommand,
  BatchGetQueryExecutionCommand,
  CreateNamedQueryCommand,
  CreatePreparedStatementCommand,
  type Database,
  DeleteNamedQueryCommand,
  DeletePreparedStatementCommand,
  type EngineVersion,
  GetDatabaseCommand,
  GetDataCatalogCommand,
  GetNamedQueryCommand,
  GetPreparedStatementCommand,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  GetQueryRuntimeStatisticsCommand,
  GetTableMetadataCommand,
  GetWorkGroupCommand,
  ListDatabasesCommand,
  ListDataCatalogsCommand,
  ListNamedQueriesCommand,
  ListPreparedStatementsCommand,
  ListQueryExecutionsCommand,
  ListTableMetadataCommand,
  ListWorkGroupsCommand,
  type NamedQuery,
  type PreparedStatement,
  StartQueryExecutionCommand,
  StopQueryExecutionCommand,
  type TableMetadata,
  UpdateNamedQueryCommand,
  UpdatePreparedStatementCommand,
} from '@aws-sdk/client-athena'
import type { AwsAthenaBatchGetNamedQueryBody } from '@/lib/api/contracts/tools/aws/athena-batch-get-named-query'
import type { AwsAthenaBatchGetPreparedStatementBody } from '@/lib/api/contracts/tools/aws/athena-batch-get-prepared-statement'
import type { AwsAthenaBatchGetQueryExecutionBody } from '@/lib/api/contracts/tools/aws/athena-batch-get-query-execution'
import type { AwsAthenaCreateNamedQueryBody } from '@/lib/api/contracts/tools/aws/athena-create-named-query'
import type { AwsAthenaCreatePreparedStatementBody } from '@/lib/api/contracts/tools/aws/athena-create-prepared-statement'
import type { AwsAthenaDeleteNamedQueryBody } from '@/lib/api/contracts/tools/aws/athena-delete-named-query'
import type { AwsAthenaDeletePreparedStatementBody } from '@/lib/api/contracts/tools/aws/athena-delete-prepared-statement'
import type { AwsAthenaGetDataCatalogBody } from '@/lib/api/contracts/tools/aws/athena-get-data-catalog'
import type { AwsAthenaGetDatabaseBody } from '@/lib/api/contracts/tools/aws/athena-get-database'
import type { AwsAthenaGetNamedQueryBody } from '@/lib/api/contracts/tools/aws/athena-get-named-query'
import type { AwsAthenaGetPreparedStatementBody } from '@/lib/api/contracts/tools/aws/athena-get-prepared-statement'
import type { AwsAthenaGetQueryExecutionBody } from '@/lib/api/contracts/tools/aws/athena-get-query-execution'
import type { AwsAthenaGetQueryResultsBody } from '@/lib/api/contracts/tools/aws/athena-get-query-results'
import type { AwsAthenaGetQueryRuntimeStatisticsBody } from '@/lib/api/contracts/tools/aws/athena-get-query-runtime-statistics'
import type { AwsAthenaGetTableMetadataBody } from '@/lib/api/contracts/tools/aws/athena-get-table-metadata'
import type { AwsAthenaGetWorkGroupBody } from '@/lib/api/contracts/tools/aws/athena-get-work-group'
import type { AwsAthenaListDataCatalogsBody } from '@/lib/api/contracts/tools/aws/athena-list-data-catalogs'
import type { AwsAthenaListDatabasesBody } from '@/lib/api/contracts/tools/aws/athena-list-databases'
import type { AwsAthenaListNamedQueriesBody } from '@/lib/api/contracts/tools/aws/athena-list-named-queries'
import type { AwsAthenaListPreparedStatementsBody } from '@/lib/api/contracts/tools/aws/athena-list-prepared-statements'
import type { AwsAthenaListQueryExecutionsBody } from '@/lib/api/contracts/tools/aws/athena-list-query-executions'
import type { AwsAthenaListTableMetadataBody } from '@/lib/api/contracts/tools/aws/athena-list-table-metadata'
import type { AwsAthenaListWorkGroupsBody } from '@/lib/api/contracts/tools/aws/athena-list-work-groups'
import type { AwsAthenaStartQueryBody } from '@/lib/api/contracts/tools/aws/athena-start-query'
import type { AwsAthenaStopQueryBody } from '@/lib/api/contracts/tools/aws/athena-stop-query'
import type { AwsAthenaUpdateNamedQueryBody } from '@/lib/api/contracts/tools/aws/athena-update-named-query'
import type { AwsAthenaUpdatePreparedStatementBody } from '@/lib/api/contracts/tools/aws/athena-update-prepared-statement'
import { type AthenaConnectionConfig, createAthenaClient } from '@/lib/internal/athena/client'

async function withAthenaClient<T>(
  input: AthenaConnectionConfig,
  execute: (client: AthenaClient) => Promise<T>
): Promise<T> {
  const client = createAthenaClient(input)
  try {
    return await execute(client)
  } finally {
    client.destroy()
  }
}

function mapNamedQuery(namedQuery: NamedQuery, fallbackId = '') {
  return {
    namedQueryId: namedQuery.NamedQueryId ?? fallbackId,
    name: namedQuery.Name ?? '',
    description: namedQuery.Description ?? null,
    database: namedQuery.Database ?? '',
    queryString: namedQuery.QueryString ?? '',
    workGroup: namedQuery.WorkGroup ?? null,
  }
}

function mapPreparedStatement(statement: PreparedStatement, fallbackName = '') {
  return {
    statementName: statement.StatementName ?? fallbackName,
    queryStatement: statement.QueryStatement ?? '',
    workGroupName: statement.WorkGroupName ?? null,
    description: statement.Description ?? null,
    lastModifiedTime: statement.LastModifiedTime?.getTime() ?? null,
  }
}

function mapTableMetadata(table: TableMetadata) {
  return {
    name: table.Name ?? '',
    tableType: table.TableType ?? null,
    createTime: table.CreateTime?.getTime() ?? null,
    lastAccessTime: table.LastAccessTime?.getTime() ?? null,
    columns: (table.Columns ?? []).map((column) => ({
      name: column.Name ?? '',
      type: column.Type ?? null,
      comment: column.Comment ?? null,
    })),
    partitionKeys: (table.PartitionKeys ?? []).map((column) => ({
      name: column.Name ?? '',
      type: column.Type ?? null,
      comment: column.Comment ?? null,
    })),
    parameters: table.Parameters ?? {},
  }
}

function mapDatabase(database: Database) {
  return {
    name: database.Name ?? '',
    description: database.Description ?? null,
    parameters: database.Parameters ?? {},
  }
}

function mapEngineVersion(engineVersion: EngineVersion | undefined) {
  if (!engineVersion) return null
  return {
    selectedEngineVersion: engineVersion.SelectedEngineVersion ?? null,
    effectiveEngineVersion: engineVersion.EffectiveEngineVersion ?? null,
  }
}

export async function executeAthenaBatchGetQueryExecution(
  input: AwsAthenaBatchGetQueryExecutionBody,
  signal?: AbortSignal
) {
  return withAthenaClient(input, async (client) => {
    const response = await client.send(
      new BatchGetQueryExecutionCommand({ QueryExecutionIds: input.queryExecutionIds }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: {
        queryExecutions: (response.QueryExecutions ?? []).map((execution) => ({
          queryExecutionId: execution.QueryExecutionId ?? '',
          query: execution.Query ?? null,
          state: execution.Status?.State ?? null,
          stateChangeReason: execution.Status?.StateChangeReason ?? null,
          statementType: execution.StatementType ?? null,
          database: execution.QueryExecutionContext?.Database ?? null,
          catalog: execution.QueryExecutionContext?.Catalog ?? null,
          workGroup: execution.WorkGroup ?? null,
          submissionDateTime: execution.Status?.SubmissionDateTime?.getTime() ?? null,
          completionDateTime: execution.Status?.CompletionDateTime?.getTime() ?? null,
          dataScannedInBytes: execution.Statistics?.DataScannedInBytes ?? null,
          engineExecutionTimeInMillis: execution.Statistics?.EngineExecutionTimeInMillis ?? null,
          queryPlanningTimeInMillis: execution.Statistics?.QueryPlanningTimeInMillis ?? null,
          queryQueueTimeInMillis: execution.Statistics?.QueryQueueTimeInMillis ?? null,
          totalExecutionTimeInMillis: execution.Statistics?.TotalExecutionTimeInMillis ?? null,
          outputLocation: execution.ResultConfiguration?.OutputLocation ?? null,
        })),
        unprocessedQueryExecutionIds: (response.UnprocessedQueryExecutionIds ?? []).map((item) => ({
          queryExecutionId: item.QueryExecutionId ?? null,
          errorCode: item.ErrorCode ?? null,
          errorMessage: item.ErrorMessage ?? null,
        })),
      },
    }
  })
}

export async function executeAthenaCreateNamedQuery(
  input: AwsAthenaCreateNamedQueryBody,
  signal?: AbortSignal
) {
  return withAthenaClient(input, async (client) => {
    const response = await client.send(
      new CreateNamedQueryCommand({
        Name: input.name,
        Database: input.database,
        QueryString: input.queryString,
        ...(input.description ? { Description: input.description } : {}),
        ...(input.workGroup ? { WorkGroup: input.workGroup } : {}),
      }),
      { abortSignal: signal }
    )
    if (!response.NamedQueryId) throw new Error('No named query ID returned')
    return { success: true, output: { namedQueryId: response.NamedQueryId } }
  })
}

export async function executeAthenaDeleteNamedQuery(
  input: AwsAthenaDeleteNamedQueryBody,
  signal?: AbortSignal
) {
  return withAthenaClient(input, async (client) => {
    await client.send(new DeleteNamedQueryCommand({ NamedQueryId: input.namedQueryId }), {
      abortSignal: signal,
    })
    return { success: true, output: { success: true } }
  })
}

export async function executeAthenaGetNamedQuery(
  input: AwsAthenaGetNamedQueryBody,
  signal?: AbortSignal
) {
  return withAthenaClient(input, async (client) => {
    const response = await client.send(
      new GetNamedQueryCommand({ NamedQueryId: input.namedQueryId }),
      {
        abortSignal: signal,
      }
    )
    const namedQuery = response.NamedQuery
    if (!namedQuery) throw new Error('No named query data returned')
    return { success: true, output: mapNamedQuery(namedQuery, input.namedQueryId) }
  })
}

export async function executeAthenaGetQueryExecution(
  input: AwsAthenaGetQueryExecutionBody,
  signal?: AbortSignal
) {
  return withAthenaClient(input, async (client) => {
    const response = await client.send(
      new GetQueryExecutionCommand({ QueryExecutionId: input.queryExecutionId }),
      { abortSignal: signal }
    )
    const execution = response.QueryExecution
    if (!execution) throw new Error('No query execution data returned')
    return {
      success: true,
      output: {
        queryExecutionId: execution.QueryExecutionId ?? input.queryExecutionId,
        query: execution.Query ?? '',
        state: execution.Status?.State ?? 'UNKNOWN',
        stateChangeReason: execution.Status?.StateChangeReason ?? null,
        statementType: execution.StatementType ?? null,
        database: execution.QueryExecutionContext?.Database ?? null,
        catalog: execution.QueryExecutionContext?.Catalog ?? null,
        workGroup: execution.WorkGroup ?? null,
        submissionDateTime: execution.Status?.SubmissionDateTime?.getTime() ?? null,
        completionDateTime: execution.Status?.CompletionDateTime?.getTime() ?? null,
        dataScannedInBytes: execution.Statistics?.DataScannedInBytes ?? null,
        engineExecutionTimeInMillis: execution.Statistics?.EngineExecutionTimeInMillis ?? null,
        queryPlanningTimeInMillis: execution.Statistics?.QueryPlanningTimeInMillis ?? null,
        queryQueueTimeInMillis: execution.Statistics?.QueryQueueTimeInMillis ?? null,
        totalExecutionTimeInMillis: execution.Statistics?.TotalExecutionTimeInMillis ?? null,
        outputLocation: execution.ResultConfiguration?.OutputLocation ?? null,
      },
    }
  })
}

export async function executeAthenaGetQueryResults(
  input: AwsAthenaGetQueryResultsBody,
  signal?: AbortSignal
) {
  return withAthenaClient(input, async (client) => {
    const isFirstPage = !input.nextToken
    const adjustedMaxResults =
      input.maxResults !== undefined && isFirstPage ? input.maxResults + 1 : input.maxResults
    const response = await client.send(
      new GetQueryResultsCommand({
        QueryExecutionId: input.queryExecutionId,
        ...(adjustedMaxResults !== undefined ? { MaxResults: adjustedMaxResults } : {}),
        ...(input.nextToken ? { NextToken: input.nextToken } : {}),
      }),
      { abortSignal: signal }
    )
    const columns = (response.ResultSet?.ResultSetMetadata?.ColumnInfo ?? []).map((column) => ({
      name: column.Name ?? '',
      type: column.Type ?? 'varchar',
    }))
    const rawRows = response.ResultSet?.Rows ?? []
    const dataRows = input.nextToken ? rawRows : rawRows.slice(1)
    const rows = dataRows.map((row) => {
      const record: Record<string, string> = {}
      const rowData = row.Data ?? []
      for (let index = 0; index < columns.length; index++) {
        record[columns[index].name] = rowData[index]?.VarCharValue ?? ''
      }
      return record
    })
    return {
      success: true,
      output: {
        columns,
        rows,
        nextToken: response.NextToken ?? null,
        updateCount: response.UpdateCount ?? null,
      },
    }
  })
}

export async function executeAthenaListDatabases(
  input: AwsAthenaListDatabasesBody,
  signal?: AbortSignal
) {
  return withAthenaClient(input, async (client) => {
    const response = await client.send(
      new ListDatabasesCommand({
        CatalogName: input.catalogName,
        ...(input.workGroup ? { WorkGroup: input.workGroup } : {}),
        ...(input.maxResults !== undefined ? { MaxResults: input.maxResults } : {}),
        ...(input.nextToken ? { NextToken: input.nextToken } : {}),
      }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: {
        databases: (response.DatabaseList ?? []).map(mapDatabase),
        nextToken: response.NextToken ?? null,
      },
    }
  })
}

export async function executeAthenaListNamedQueries(
  input: AwsAthenaListNamedQueriesBody,
  signal?: AbortSignal
) {
  return withAthenaClient(input, async (client) => {
    const response = await client.send(
      new ListNamedQueriesCommand({
        ...(input.workGroup ? { WorkGroup: input.workGroup } : {}),
        ...(input.maxResults !== undefined ? { MaxResults: input.maxResults } : {}),
        ...(input.nextToken ? { NextToken: input.nextToken } : {}),
      }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: {
        namedQueryIds: response.NamedQueryIds ?? [],
        nextToken: response.NextToken ?? null,
      },
    }
  })
}

export async function executeAthenaListQueryExecutions(
  input: AwsAthenaListQueryExecutionsBody,
  signal?: AbortSignal
) {
  return withAthenaClient(input, async (client) => {
    const response = await client.send(
      new ListQueryExecutionsCommand({
        ...(input.workGroup ? { WorkGroup: input.workGroup } : {}),
        ...(input.maxResults !== undefined ? { MaxResults: input.maxResults } : {}),
        ...(input.nextToken ? { NextToken: input.nextToken } : {}),
      }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: {
        queryExecutionIds: response.QueryExecutionIds ?? [],
        nextToken: response.NextToken ?? null,
      },
    }
  })
}

export async function executeAthenaListTableMetadata(
  input: AwsAthenaListTableMetadataBody,
  signal?: AbortSignal
) {
  return withAthenaClient(input, async (client) => {
    const response = await client.send(
      new ListTableMetadataCommand({
        CatalogName: input.catalogName,
        DatabaseName: input.databaseName,
        ...(input.expression ? { Expression: input.expression } : {}),
        ...(input.workGroup ? { WorkGroup: input.workGroup } : {}),
        ...(input.maxResults !== undefined ? { MaxResults: input.maxResults } : {}),
        ...(input.nextToken ? { NextToken: input.nextToken } : {}),
      }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: {
        tables: (response.TableMetadataList ?? []).map(mapTableMetadata),
        nextToken: response.NextToken ?? null,
      },
    }
  })
}

export async function executeAthenaStartQuery(
  input: AwsAthenaStartQueryBody,
  signal?: AbortSignal
) {
  return withAthenaClient(input, async (client) => {
    const response = await client.send(
      new StartQueryExecutionCommand({
        QueryString: input.queryString,
        ...(input.database || input.catalog
          ? {
              QueryExecutionContext: {
                ...(input.database ? { Database: input.database } : {}),
                ...(input.catalog ? { Catalog: input.catalog } : {}),
              },
            }
          : {}),
        ...(input.outputLocation
          ? { ResultConfiguration: { OutputLocation: input.outputLocation } }
          : {}),
        ...(input.workGroup ? { WorkGroup: input.workGroup } : {}),
        ...(input.executionParameters ? { ExecutionParameters: input.executionParameters } : {}),
        ...(input.resultReuseEnabled !== undefined
          ? {
              ResultReuseConfiguration: {
                ResultReuseByAgeConfiguration: {
                  Enabled: input.resultReuseEnabled,
                  ...(input.resultReuseMaxAgeInMinutes !== undefined
                    ? { MaxAgeInMinutes: input.resultReuseMaxAgeInMinutes }
                    : {}),
                },
              },
            }
          : {}),
      }),
      { abortSignal: signal }
    )
    if (!response.QueryExecutionId) throw new Error('No query execution ID returned')
    return { success: true, output: { queryExecutionId: response.QueryExecutionId } }
  })
}

export async function executeAthenaStopQuery(input: AwsAthenaStopQueryBody, signal?: AbortSignal) {
  return withAthenaClient(input, async (client) => {
    await client.send(new StopQueryExecutionCommand({ QueryExecutionId: input.queryExecutionId }), {
      abortSignal: signal,
    })
    return { success: true, output: { success: true } }
  })
}

export async function executeAthenaGetQueryRuntimeStatistics(
  input: AwsAthenaGetQueryRuntimeStatisticsBody,
  signal?: AbortSignal
) {
  return withAthenaClient(input, async (client) => {
    const response = await client.send(
      new GetQueryRuntimeStatisticsCommand({ QueryExecutionId: input.queryExecutionId }),
      { abortSignal: signal }
    )
    const statistics = response.QueryRuntimeStatistics
    if (!statistics) throw new Error('No query runtime statistics returned')
    const timeline = statistics.Timeline
    const rows = statistics.Rows
    const outputStage = statistics.OutputStage
    return {
      success: true,
      output: {
        queryExecutionId: input.queryExecutionId,
        timeline: {
          queryQueueTimeInMillis: timeline?.QueryQueueTimeInMillis ?? null,
          servicePreProcessingTimeInMillis: timeline?.ServicePreProcessingTimeInMillis ?? null,
          queryPlanningTimeInMillis: timeline?.QueryPlanningTimeInMillis ?? null,
          engineExecutionTimeInMillis: timeline?.EngineExecutionTimeInMillis ?? null,
          serviceProcessingTimeInMillis: timeline?.ServiceProcessingTimeInMillis ?? null,
          totalExecutionTimeInMillis: timeline?.TotalExecutionTimeInMillis ?? null,
        },
        rowStatistics: {
          inputRows: rows?.InputRows ?? null,
          inputBytes: rows?.InputBytes ?? null,
          outputRows: rows?.OutputRows ?? null,
          outputBytes: rows?.OutputBytes ?? null,
        },
        outputStage: outputStage
          ? {
              stageId: outputStage.StageId ?? null,
              state: outputStage.State ?? null,
              inputRows: outputStage.InputRows ?? null,
              inputBytes: outputStage.InputBytes ?? null,
              outputRows: outputStage.OutputRows ?? null,
              outputBytes: outputStage.OutputBytes ?? null,
              executionTime: outputStage.ExecutionTime ?? null,
              subStageCount: outputStage.SubStages?.length ?? 0,
            }
          : null,
      },
    }
  })
}

export async function executeAthenaBatchGetNamedQuery(
  input: AwsAthenaBatchGetNamedQueryBody,
  signal?: AbortSignal
) {
  return withAthenaClient(input, async (client) => {
    const response = await client.send(
      new BatchGetNamedQueryCommand({ NamedQueryIds: input.namedQueryIds }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: {
        namedQueries: (response.NamedQueries ?? []).map((namedQuery) => mapNamedQuery(namedQuery)),
        unprocessedNamedQueryIds: (response.UnprocessedNamedQueryIds ?? []).map((item) => ({
          namedQueryId: item.NamedQueryId ?? null,
          errorCode: item.ErrorCode ?? null,
          errorMessage: item.ErrorMessage ?? null,
        })),
      },
    }
  })
}

export async function executeAthenaUpdateNamedQuery(
  input: AwsAthenaUpdateNamedQueryBody,
  signal?: AbortSignal
) {
  return withAthenaClient(input, async (client) => {
    await client.send(
      new UpdateNamedQueryCommand({
        NamedQueryId: input.namedQueryId,
        Name: input.name,
        QueryString: input.queryString,
        ...(input.description !== undefined ? { Description: input.description } : {}),
      }),
      { abortSignal: signal }
    )
    return { success: true, output: { success: true } }
  })
}

export async function executeAthenaGetDatabase(
  input: AwsAthenaGetDatabaseBody,
  signal?: AbortSignal
) {
  return withAthenaClient(input, async (client) => {
    const response = await client.send(
      new GetDatabaseCommand({
        CatalogName: input.catalogName,
        DatabaseName: input.databaseName,
        ...(input.workGroup ? { WorkGroup: input.workGroup } : {}),
      }),
      { abortSignal: signal }
    )
    if (!response.Database) throw new Error('No database data returned')
    return { success: true, output: mapDatabase(response.Database) }
  })
}

export async function executeAthenaGetTableMetadata(
  input: AwsAthenaGetTableMetadataBody,
  signal?: AbortSignal
) {
  return withAthenaClient(input, async (client) => {
    const response = await client.send(
      new GetTableMetadataCommand({
        CatalogName: input.catalogName,
        DatabaseName: input.databaseName,
        TableName: input.tableName,
        ...(input.workGroup ? { WorkGroup: input.workGroup } : {}),
      }),
      { abortSignal: signal }
    )
    if (!response.TableMetadata) throw new Error('No table metadata returned')
    return { success: true, output: mapTableMetadata(response.TableMetadata) }
  })
}

export async function executeAthenaListDataCatalogs(
  input: AwsAthenaListDataCatalogsBody,
  signal?: AbortSignal
) {
  return withAthenaClient(input, async (client) => {
    const response = await client.send(
      new ListDataCatalogsCommand({
        ...(input.workGroup ? { WorkGroup: input.workGroup } : {}),
        ...(input.maxResults !== undefined ? { MaxResults: input.maxResults } : {}),
        ...(input.nextToken ? { NextToken: input.nextToken } : {}),
      }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: {
        dataCatalogs: (response.DataCatalogsSummary ?? []).map((catalog) => ({
          catalogName: catalog.CatalogName ?? '',
          type: catalog.Type ?? null,
          status: catalog.Status ?? null,
          connectionType: catalog.ConnectionType ?? null,
          error: catalog.Error ?? null,
        })),
        nextToken: response.NextToken ?? null,
      },
    }
  })
}

export async function executeAthenaGetDataCatalog(
  input: AwsAthenaGetDataCatalogBody,
  signal?: AbortSignal
) {
  return withAthenaClient(input, async (client) => {
    const response = await client.send(
      new GetDataCatalogCommand({
        Name: input.name,
        ...(input.workGroup ? { WorkGroup: input.workGroup } : {}),
      }),
      { abortSignal: signal }
    )
    const catalog = response.DataCatalog
    if (!catalog) throw new Error('No data catalog data returned')
    return {
      success: true,
      output: {
        name: catalog.Name ?? input.name,
        type: catalog.Type ?? '',
        description: catalog.Description ?? null,
        status: catalog.Status ?? null,
        connectionType: catalog.ConnectionType ?? null,
        error: catalog.Error ?? null,
        parameters: catalog.Parameters ?? {},
      },
    }
  })
}

export async function executeAthenaListWorkGroups(
  input: AwsAthenaListWorkGroupsBody,
  signal?: AbortSignal
) {
  return withAthenaClient(input, async (client) => {
    const response = await client.send(
      new ListWorkGroupsCommand({
        ...(input.maxResults !== undefined ? { MaxResults: input.maxResults } : {}),
        ...(input.nextToken ? { NextToken: input.nextToken } : {}),
      }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: {
        workGroups: (response.WorkGroups ?? []).map((workGroup) => ({
          name: workGroup.Name ?? '',
          state: workGroup.State ?? null,
          description: workGroup.Description ?? null,
          creationTime: workGroup.CreationTime?.getTime() ?? null,
          engineVersion: mapEngineVersion(workGroup.EngineVersion),
          identityCenterApplicationArn: workGroup.IdentityCenterApplicationArn ?? null,
        })),
        nextToken: response.NextToken ?? null,
      },
    }
  })
}

export async function executeAthenaGetWorkGroup(
  input: AwsAthenaGetWorkGroupBody,
  signal?: AbortSignal
) {
  return withAthenaClient(input, async (client) => {
    const response = await client.send(new GetWorkGroupCommand({ WorkGroup: input.workGroup }), {
      abortSignal: signal,
    })
    const workGroup = response.WorkGroup
    if (!workGroup) throw new Error('No workgroup data returned')
    const configuration = workGroup.Configuration
    const resultConfiguration = configuration?.ResultConfiguration
    return {
      success: true,
      output: {
        name: workGroup.Name ?? input.workGroup,
        state: workGroup.State ?? null,
        description: workGroup.Description ?? null,
        creationTime: workGroup.CreationTime?.getTime() ?? null,
        identityCenterApplicationArn: workGroup.IdentityCenterApplicationArn ?? null,
        engineVersion: mapEngineVersion(configuration?.EngineVersion),
        outputLocation: resultConfiguration?.OutputLocation ?? null,
        encryptionOption: resultConfiguration?.EncryptionConfiguration?.EncryptionOption ?? null,
        kmsKey: resultConfiguration?.EncryptionConfiguration?.KmsKey ?? null,
        expectedBucketOwner: resultConfiguration?.ExpectedBucketOwner ?? null,
        managedQueryResultsEnabled:
          configuration?.ManagedQueryResultsConfiguration?.Enabled ?? null,
        enforceWorkGroupConfiguration: configuration?.EnforceWorkGroupConfiguration ?? null,
        publishCloudWatchMetricsEnabled: configuration?.PublishCloudWatchMetricsEnabled ?? null,
        bytesScannedCutoffPerQuery: configuration?.BytesScannedCutoffPerQuery ?? null,
        requesterPaysEnabled: configuration?.RequesterPaysEnabled ?? null,
        enableMinimumEncryptionConfiguration:
          configuration?.EnableMinimumEncryptionConfiguration ?? null,
        executionRole: configuration?.ExecutionRole ?? null,
      },
    }
  })
}

export async function executeAthenaCreatePreparedStatement(
  input: AwsAthenaCreatePreparedStatementBody,
  signal?: AbortSignal
) {
  return withAthenaClient(input, async (client) => {
    await client.send(
      new CreatePreparedStatementCommand({
        StatementName: input.statementName,
        WorkGroup: input.workGroup,
        QueryStatement: input.queryStatement,
        ...(input.description ? { Description: input.description } : {}),
      }),
      { abortSignal: signal }
    )
    return { success: true, output: { success: true } }
  })
}

export async function executeAthenaGetPreparedStatement(
  input: AwsAthenaGetPreparedStatementBody,
  signal?: AbortSignal
) {
  return withAthenaClient(input, async (client) => {
    const response = await client.send(
      new GetPreparedStatementCommand({
        StatementName: input.statementName,
        WorkGroup: input.workGroup,
      }),
      { abortSignal: signal }
    )
    if (!response.PreparedStatement) throw new Error('No prepared statement data returned')
    return {
      success: true,
      output: mapPreparedStatement(response.PreparedStatement, input.statementName),
    }
  })
}

export async function executeAthenaUpdatePreparedStatement(
  input: AwsAthenaUpdatePreparedStatementBody,
  signal?: AbortSignal
) {
  return withAthenaClient(input, async (client) => {
    await client.send(
      new UpdatePreparedStatementCommand({
        StatementName: input.statementName,
        WorkGroup: input.workGroup,
        QueryStatement: input.queryStatement,
        ...(input.description ? { Description: input.description } : {}),
      }),
      { abortSignal: signal }
    )
    return { success: true, output: { success: true } }
  })
}

export async function executeAthenaDeletePreparedStatement(
  input: AwsAthenaDeletePreparedStatementBody,
  signal?: AbortSignal
) {
  return withAthenaClient(input, async (client) => {
    await client.send(
      new DeletePreparedStatementCommand({
        StatementName: input.statementName,
        WorkGroup: input.workGroup,
      }),
      { abortSignal: signal }
    )
    return { success: true, output: { success: true } }
  })
}

export async function executeAthenaListPreparedStatements(
  input: AwsAthenaListPreparedStatementsBody,
  signal?: AbortSignal
) {
  return withAthenaClient(input, async (client) => {
    const response = await client.send(
      new ListPreparedStatementsCommand({
        WorkGroup: input.workGroup,
        ...(input.maxResults !== undefined ? { MaxResults: input.maxResults } : {}),
        ...(input.nextToken ? { NextToken: input.nextToken } : {}),
      }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: {
        preparedStatements: (response.PreparedStatements ?? []).map((statement) => ({
          statementName: statement.StatementName ?? '',
          lastModifiedTime: statement.LastModifiedTime?.getTime() ?? null,
        })),
        nextToken: response.NextToken ?? null,
      },
    }
  })
}

export async function executeAthenaBatchGetPreparedStatement(
  input: AwsAthenaBatchGetPreparedStatementBody,
  signal?: AbortSignal
) {
  return withAthenaClient(input, async (client) => {
    const response = await client.send(
      new BatchGetPreparedStatementCommand({
        PreparedStatementNames: input.preparedStatementNames,
        WorkGroup: input.workGroup,
      }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: {
        preparedStatements: (response.PreparedStatements ?? []).map((statement) =>
          mapPreparedStatement(statement)
        ),
        unprocessedPreparedStatementNames: (response.UnprocessedPreparedStatementNames ?? []).map(
          (item) => ({
            statementName: item.StatementName ?? null,
            errorCode: item.ErrorCode ?? null,
            errorMessage: item.ErrorMessage ?? null,
          })
        ),
      },
    }
  })
}
