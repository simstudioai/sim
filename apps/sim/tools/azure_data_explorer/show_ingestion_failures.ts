import type {
  AzureDataExplorerShowIngestionFailuresParams,
  AzureDataExplorerTableResponse,
} from '@/tools/azure_data_explorer/types'
import {
  AZURE_DATA_EXPLORER_PROXY_URL,
  azureDataExplorerAuthBody,
  renderOperationId,
  transformAzureDataExplorerResponse,
} from '@/tools/azure_data_explorer/utils'
import type { ToolConfig } from '@/tools/types'

export const azureDataExplorerShowIngestionFailuresTool: ToolConfig<
  AzureDataExplorerShowIngestionFailuresParams,
  AzureDataExplorerTableResponse
> = {
  id: 'azure_data_explorer_show_ingestion_failures',
  name: 'Azure Data Explorer Show Ingestion Failures',
  description:
    'List ingestion failures recorded for a database, with the failing table, error code, root cause detail, and whether the failure is permanent or transient. Failures are retained for 14 days.',
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
      required: true,
      visibility: 'user-or-llm',
      description: 'Database whose ingestion failures should be listed',
    },
    operationId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Limit results to a single ingestion operation ID',
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
        ? `.show ingestion failures with (OperationId = ${renderOperationId(params.operationId)})`
        : '.show ingestion failures',
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
