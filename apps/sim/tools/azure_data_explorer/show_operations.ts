import type {
  AzureDataExplorerShowOperationsParams,
  AzureDataExplorerTableResponse,
} from '@/tools/azure_data_explorer/types'
import {
  AZURE_DATA_EXPLORER_PROXY_URL,
  azureDataExplorerAuthBody,
  renderOperationId,
  transformAzureDataExplorerResponse,
} from '@/tools/azure_data_explorer/utils'
import type { ToolConfig } from '@/tools/types'

export const azureDataExplorerShowOperationsTool: ToolConfig<
  AzureDataExplorerShowOperationsParams,
  AzureDataExplorerTableResponse
> = {
  id: 'azure_data_explorer_show_operations',
  name: 'Azure Data Explorer Show Operations',
  description:
    'Check the state of administrative operations on a cluster, such as an async ingestion. Given an operation ID it returns that operation latest update; with no ID it returns the operations from the last two weeks.',
  version: '1.0.0',
  params: {
    clusterUri: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Cluster URI (e.g., https://mycluster.eastus.kusto.windows.net)',
    },
    tenantId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Microsoft Entra tenant ID hosting the service principal',
    },
    clientId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Microsoft Entra application (client) ID',
    },
    clientSecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Microsoft Entra application client secret',
    },
    resource: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Token audience override. Defaults to the cluster URI itself',
    },
    database: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Database context for the command',
    },
    operationId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Operation ID to check, e.g. the ID returned by an async ingestion',
    },
  },
  request: {
    url: AZURE_DATA_EXPLORER_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      ...azureDataExplorerAuthBody(params),
      endpoint: 'mgmt',
      database: params.database,
      csl: params.operationId
        ? `.show operations ${renderOperationId(params.operationId)}`
        : '.show operations',
    }),
  },
  transformResponse: transformAzureDataExplorerResponse,
  outputs: {
    tableName: {
      type: 'string',
      description: 'Name Kusto assigned to the returned result table',
      nullable: true,
    },
    columns: {
      type: 'array',
      description: 'Column metadata for the result table',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Column name' },
          type: { type: 'string', description: 'Kusto scalar type', nullable: true },
          dataType: { type: 'string', description: 'Approximate .NET type', nullable: true },
        },
      },
    },
    rows: {
      type: 'array',
      description: 'Result rows as positional arrays matching the columns order',
      items: { type: 'array' },
    },
    records: {
      type: 'array',
      description: 'Result rows keyed by column name',
      items: { type: 'object' },
    },
    rowCount: { type: 'number', description: 'Rows carried in this result, after the row cap' },
    totalRowCount: {
      type: 'number',
      description: 'Rows Kusto returned, before the row cap was applied',
    },
    truncated: {
      type: 'boolean',
      description:
        'Whether rows were dropped to stay within the row cap — narrow the query if true',
    },
  },
}
