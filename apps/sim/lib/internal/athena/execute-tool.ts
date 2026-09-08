import { getErrorMessage } from '@sim/utils/errors'
import type { AnyApiRouteContract, ContractBody } from '@/lib/api/contracts'
import { awsAthenaBatchGetNamedQueryContract } from '@/lib/api/contracts/tools/aws/athena-batch-get-named-query'
import { awsAthenaBatchGetPreparedStatementContract } from '@/lib/api/contracts/tools/aws/athena-batch-get-prepared-statement'
import { awsAthenaBatchGetQueryExecutionContract } from '@/lib/api/contracts/tools/aws/athena-batch-get-query-execution'
import { awsAthenaCreateNamedQueryContract } from '@/lib/api/contracts/tools/aws/athena-create-named-query'
import { awsAthenaCreatePreparedStatementContract } from '@/lib/api/contracts/tools/aws/athena-create-prepared-statement'
import { awsAthenaDeleteNamedQueryContract } from '@/lib/api/contracts/tools/aws/athena-delete-named-query'
import { awsAthenaDeletePreparedStatementContract } from '@/lib/api/contracts/tools/aws/athena-delete-prepared-statement'
import { awsAthenaGetDataCatalogContract } from '@/lib/api/contracts/tools/aws/athena-get-data-catalog'
import { awsAthenaGetDatabaseContract } from '@/lib/api/contracts/tools/aws/athena-get-database'
import { awsAthenaGetNamedQueryContract } from '@/lib/api/contracts/tools/aws/athena-get-named-query'
import { awsAthenaGetPreparedStatementContract } from '@/lib/api/contracts/tools/aws/athena-get-prepared-statement'
import { awsAthenaGetQueryExecutionContract } from '@/lib/api/contracts/tools/aws/athena-get-query-execution'
import { awsAthenaGetQueryResultsContract } from '@/lib/api/contracts/tools/aws/athena-get-query-results'
import { awsAthenaGetQueryRuntimeStatisticsContract } from '@/lib/api/contracts/tools/aws/athena-get-query-runtime-statistics'
import { awsAthenaGetTableMetadataContract } from '@/lib/api/contracts/tools/aws/athena-get-table-metadata'
import { awsAthenaGetWorkGroupContract } from '@/lib/api/contracts/tools/aws/athena-get-work-group'
import { awsAthenaListDataCatalogsContract } from '@/lib/api/contracts/tools/aws/athena-list-data-catalogs'
import { awsAthenaListDatabasesContract } from '@/lib/api/contracts/tools/aws/athena-list-databases'
import { awsAthenaListNamedQueriesContract } from '@/lib/api/contracts/tools/aws/athena-list-named-queries'
import { awsAthenaListPreparedStatementsContract } from '@/lib/api/contracts/tools/aws/athena-list-prepared-statements'
import { awsAthenaListQueryExecutionsContract } from '@/lib/api/contracts/tools/aws/athena-list-query-executions'
import { awsAthenaListTableMetadataContract } from '@/lib/api/contracts/tools/aws/athena-list-table-metadata'
import { awsAthenaListWorkGroupsContract } from '@/lib/api/contracts/tools/aws/athena-list-work-groups'
import { awsAthenaStartQueryContract } from '@/lib/api/contracts/tools/aws/athena-start-query'
import { awsAthenaStopQueryContract } from '@/lib/api/contracts/tools/aws/athena-stop-query'
import { awsAthenaUpdateNamedQueryContract } from '@/lib/api/contracts/tools/aws/athena-update-named-query'
import { awsAthenaUpdatePreparedStatementContract } from '@/lib/api/contracts/tools/aws/athena-update-prepared-statement'
import {
  executeAthenaBatchGetNamedQuery,
  executeAthenaBatchGetPreparedStatement,
  executeAthenaBatchGetQueryExecution,
  executeAthenaCreateNamedQuery,
  executeAthenaCreatePreparedStatement,
  executeAthenaDeleteNamedQuery,
  executeAthenaDeletePreparedStatement,
  executeAthenaGetDatabase,
  executeAthenaGetDataCatalog,
  executeAthenaGetNamedQuery,
  executeAthenaGetPreparedStatement,
  executeAthenaGetQueryExecution,
  executeAthenaGetQueryResults,
  executeAthenaGetQueryRuntimeStatistics,
  executeAthenaGetTableMetadata,
  executeAthenaGetWorkGroup,
  executeAthenaListDatabases,
  executeAthenaListDataCatalogs,
  executeAthenaListNamedQueries,
  executeAthenaListPreparedStatements,
  executeAthenaListQueryExecutions,
  executeAthenaListTableMetadata,
  executeAthenaListWorkGroups,
  executeAthenaStartQuery,
  executeAthenaStopQuery,
  executeAthenaUpdateNamedQuery,
  executeAthenaUpdatePreparedStatement,
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
    case 'athena_batch_get_named_query':
      return executeOperation(
        awsAthenaBatchGetNamedQueryContract,
        input,
        executeAthenaBatchGetNamedQuery,
        'Failed to batch get Athena named queries',
        signal
      )
    case 'athena_batch_get_prepared_statement':
      return executeOperation(
        awsAthenaBatchGetPreparedStatementContract,
        input,
        executeAthenaBatchGetPreparedStatement,
        'Failed to batch get Athena prepared statements',
        signal
      )
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
    case 'athena_create_prepared_statement':
      return executeOperation(
        awsAthenaCreatePreparedStatementContract,
        input,
        executeAthenaCreatePreparedStatement,
        'Failed to create Athena prepared statement',
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
    case 'athena_delete_prepared_statement':
      return executeOperation(
        awsAthenaDeletePreparedStatementContract,
        input,
        executeAthenaDeletePreparedStatement,
        'Failed to delete Athena prepared statement',
        signal
      )
    case 'athena_get_data_catalog':
      return executeOperation(
        awsAthenaGetDataCatalogContract,
        input,
        executeAthenaGetDataCatalog,
        'Failed to get Athena data catalog',
        signal
      )
    case 'athena_get_database':
      return executeOperation(
        awsAthenaGetDatabaseContract,
        input,
        executeAthenaGetDatabase,
        'Failed to get Athena database',
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
    case 'athena_get_prepared_statement':
      return executeOperation(
        awsAthenaGetPreparedStatementContract,
        input,
        executeAthenaGetPreparedStatement,
        'Failed to get Athena prepared statement',
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
    case 'athena_get_query_runtime_statistics':
      return executeOperation(
        awsAthenaGetQueryRuntimeStatisticsContract,
        input,
        executeAthenaGetQueryRuntimeStatistics,
        'Failed to get Athena query runtime statistics',
        signal
      )
    case 'athena_get_table_metadata':
      return executeOperation(
        awsAthenaGetTableMetadataContract,
        input,
        executeAthenaGetTableMetadata,
        'Failed to get Athena table metadata',
        signal
      )
    case 'athena_get_work_group':
      return executeOperation(
        awsAthenaGetWorkGroupContract,
        input,
        executeAthenaGetWorkGroup,
        'Failed to get Athena workgroup',
        signal
      )
    case 'athena_list_data_catalogs':
      return executeOperation(
        awsAthenaListDataCatalogsContract,
        input,
        executeAthenaListDataCatalogs,
        'Failed to list Athena data catalogs',
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
    case 'athena_list_prepared_statements':
      return executeOperation(
        awsAthenaListPreparedStatementsContract,
        input,
        executeAthenaListPreparedStatements,
        'Failed to list Athena prepared statements',
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
    case 'athena_list_work_groups':
      return executeOperation(
        awsAthenaListWorkGroupsContract,
        input,
        executeAthenaListWorkGroups,
        'Failed to list Athena workgroups',
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
    case 'athena_update_named_query':
      return executeOperation(
        awsAthenaUpdateNamedQueryContract,
        input,
        executeAthenaUpdateNamedQuery,
        'Failed to update Athena named query',
        signal
      )
    case 'athena_update_prepared_statement':
      return executeOperation(
        awsAthenaUpdatePreparedStatementContract,
        input,
        executeAthenaUpdatePreparedStatement,
        'Failed to update Athena prepared statement',
        signal
      )
    default:
      return Response.json({ error: `Unsupported Athena tool: ${toolId}` }, { status: 500 })
  }
}
