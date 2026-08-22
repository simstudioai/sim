import type {
  AzureDataExplorerDropTableParams,
  AzureDataExplorerTableListResponse,
} from '@/tools/azure_data_explorer/types'
import {
  AZURE_DATA_EXPLORER_PROXY_URL,
  azureDataExplorerAuthBody,
  renderEntityName,
  transformColumnListResponse,
} from '@/tools/azure_data_explorer/utils'
import type { ToolConfig } from '@/tools/types'

export const azureDataExplorerDropTableTool: ToolConfig<
  AzureDataExplorerDropTableParams,
  AzureDataExplorerTableListResponse
> = {
  id: 'azure_data_explorer_drop_table',
  name: 'Azure Data Explorer Drop Table',
  description:
    'Drop a table from an Azure Data Explorer database. This permanently deletes the table and its data, and returns the tables that remain.',
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
      description: 'Database containing the table',
    },
    table: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the table to drop',
    },
    ifExists: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Succeed instead of failing when the table does not exist',
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
      csl: `.drop table ${renderEntityName(params.table)}${params.ifExists ? ' ifexists' : ''}`,
    }),
  },
  transformResponse: transformColumnListResponse('TableName', 'tables'),
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
    tables: {
      type: 'array',
      description: 'Tables remaining in the database, read from the TableName column',
      items: { type: 'string' },
    },
  },
}
