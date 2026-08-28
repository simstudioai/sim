import {
  type AthenaClient,
  BatchGetQueryExecutionCommand,
  CreateNamedQueryCommand,
  DeleteNamedQueryCommand,
  GetNamedQueryCommand,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  ListDatabasesCommand,
  ListNamedQueriesCommand,
  ListQueryExecutionsCommand,
  ListTableMetadataCommand,
  StartQueryExecutionCommand,
  StopQueryExecutionCommand,
} from '@aws-sdk/client-athena'
import type { AwsAthenaBatchGetQueryExecutionBody } from '@/lib/api/contracts/tools/aws/athena-batch-get-query-execution'
import type { AwsAthenaCreateNamedQueryBody } from '@/lib/api/contracts/tools/aws/athena-create-named-query'
import type { AwsAthenaDeleteNamedQueryBody } from '@/lib/api/contracts/tools/aws/athena-delete-named-query'
import type { AwsAthenaGetNamedQueryBody } from '@/lib/api/contracts/tools/aws/athena-get-named-query'
import type { AwsAthenaGetQueryExecutionBody } from '@/lib/api/contracts/tools/aws/athena-get-query-execution'
import type { AwsAthenaGetQueryResultsBody } from '@/lib/api/contracts/tools/aws/athena-get-query-results'
import type { AwsAthenaListDatabasesBody } from '@/lib/api/contracts/tools/aws/athena-list-databases'
import type { AwsAthenaListNamedQueriesBody } from '@/lib/api/contracts/tools/aws/athena-list-named-queries'
import type { AwsAthenaListQueryExecutionsBody } from '@/lib/api/contracts/tools/aws/athena-list-query-executions'
import type { AwsAthenaListTableMetadataBody } from '@/lib/api/contracts/tools/aws/athena-list-table-metadata'
import type { AwsAthenaStartQueryBody } from '@/lib/api/contracts/tools/aws/athena-start-query'
import type { AwsAthenaStopQueryBody } from '@/lib/api/contracts/tools/aws/athena-stop-query'
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
    return {
      success: true,
      output: {
        namedQueryId: namedQuery.NamedQueryId ?? input.namedQueryId,
        name: namedQuery.Name ?? '',
        description: namedQuery.Description ?? null,
        database: namedQuery.Database ?? '',
        queryString: namedQuery.QueryString ?? '',
        workGroup: namedQuery.WorkGroup ?? null,
      },
    }
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
        databases: (response.DatabaseList ?? []).map((database) => ({
          name: database.Name ?? '',
          description: database.Description ?? null,
        })),
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
        tables: (response.TableMetadataList ?? []).map((table) => ({
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
        })),
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
