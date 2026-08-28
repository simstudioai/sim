import { getErrorMessage } from '@sim/utils/errors'
import type { AnyApiRouteContract, ContractBody } from '@/lib/api/contracts'
import { awsAthenaBatchGetQueryExecutionContract } from '@/lib/api/contracts/tools/aws/athena-batch-get-query-execution'
import { awsAthenaCreateNamedQueryContract } from '@/lib/api/contracts/tools/aws/athena-create-named-query'
import { awsAthenaDeleteNamedQueryContract } from '@/lib/api/contracts/tools/aws/athena-delete-named-query'
import { awsAthenaGetNamedQueryContract } from '@/lib/api/contracts/tools/aws/athena-get-named-query'
import { awsAthenaGetQueryExecutionContract } from '@/lib/api/contracts/tools/aws/athena-get-query-execution'
import { awsAthenaGetQueryResultsContract } from '@/lib/api/contracts/tools/aws/athena-get-query-results'
import { awsAthenaListDatabasesContract } from '@/lib/api/contracts/tools/aws/athena-list-databases'
import { awsAthenaListNamedQueriesContract } from '@/lib/api/contracts/tools/aws/athena-list-named-queries'
import { awsAthenaListQueryExecutionsContract } from '@/lib/api/contracts/tools/aws/athena-list-query-executions'
import { awsAthenaListTableMetadataContract } from '@/lib/api/contracts/tools/aws/athena-list-table-metadata'
import { awsAthenaStartQueryContract } from '@/lib/api/contracts/tools/aws/athena-start-query'
import { awsAthenaStopQueryContract } from '@/lib/api/contracts/tools/aws/athena-stop-query'
import {
  executeAthenaBatchGetQueryExecution,
  executeAthenaCreateNamedQuery,
  executeAthenaDeleteNamedQuery,
  executeAthenaGetNamedQuery,
  executeAthenaGetQueryExecution,
  executeAthenaGetQueryResults,
  executeAthenaListDatabases,
  executeAthenaListNamedQueries,
  executeAthenaListQueryExecutions,
  executeAthenaListTableMetadata,
  executeAthenaStartQuery,
  executeAthenaStopQuery,
} from '@/lib/internal/athena/operations'
import { parseInternalToolInput } from '@/lib/internal/tool-operations/parse-input'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

async function executeOperation<C extends AnyApiRouteContract>(
  contract: C,
  input: unknown,
  execute: (input: ContractBody<C>, signal?: AbortSignal) => Promise<unknown>,
  fallbackError: string,
  signal?: AbortSignal
): Promise<Response> {
  signal?.throwIfAborted()
  const parsed = parseInternalToolInput(contract, input)
  if (!parsed.success) return parsed.response

  try {
    const result = await execute(parsed.data, signal)
    signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    signal?.throwIfAborted()
    return Response.json({ error: getErrorMessage(error, fallbackError) }, { status: 500 })
  }
}

export const executeAthenaTool: InternalToolOperationHandler = async ({
  toolId,
  input,
  signal,
}) => {
  signal?.throwIfAborted()
  switch (toolId) {
    case 'athena_batch_get_query_execution':
      return executeOperation(
        awsAthenaBatchGetQueryExecutionContract,
        input,
        executeAthenaBatchGetQueryExecution,
        'Failed to batch get Athena query executions',
        signal
      )
    case 'athena_create_named_query':
      return executeOperation(
        awsAthenaCreateNamedQueryContract,
        input,
        executeAthenaCreateNamedQuery,
        'Failed to create Athena named query',
        signal
      )
    case 'athena_delete_named_query':
      return executeOperation(
        awsAthenaDeleteNamedQueryContract,
        input,
        executeAthenaDeleteNamedQuery,
        'Failed to delete Athena named query',
        signal
      )
    case 'athena_get_named_query':
      return executeOperation(
        awsAthenaGetNamedQueryContract,
        input,
        executeAthenaGetNamedQuery,
        'Failed to get Athena named query',
        signal
      )
    case 'athena_get_query_execution':
      return executeOperation(
        awsAthenaGetQueryExecutionContract,
        input,
        executeAthenaGetQueryExecution,
        'Failed to get Athena query execution',
        signal
      )
    case 'athena_get_query_results':
      return executeOperation(
        awsAthenaGetQueryResultsContract,
        input,
        executeAthenaGetQueryResults,
        'Failed to get Athena query results',
        signal
      )
    case 'athena_list_databases':
      return executeOperation(
        awsAthenaListDatabasesContract,
        input,
        executeAthenaListDatabases,
        'Failed to list Athena databases',
        signal
      )
    case 'athena_list_named_queries':
      return executeOperation(
        awsAthenaListNamedQueriesContract,
        input,
        executeAthenaListNamedQueries,
        'Failed to list Athena named queries',
        signal
      )
    case 'athena_list_query_executions':
      return executeOperation(
        awsAthenaListQueryExecutionsContract,
        input,
        executeAthenaListQueryExecutions,
        'Failed to list Athena query executions',
        signal
      )
    case 'athena_list_table_metadata':
      return executeOperation(
        awsAthenaListTableMetadataContract,
        input,
        executeAthenaListTableMetadata,
        'Failed to list Athena table metadata',
        signal
      )
    case 'athena_start_query':
      return executeOperation(
        awsAthenaStartQueryContract,
        input,
        executeAthenaStartQuery,
        'Failed to start Athena query',
        signal
      )
    case 'athena_stop_query':
      return executeOperation(
        awsAthenaStopQueryContract,
        input,
        executeAthenaStopQuery,
        'Failed to stop Athena query',
        signal
      )
    default:
      return Response.json({ error: `Unsupported Athena tool: ${toolId}` }, { status: 500 })
  }
}
