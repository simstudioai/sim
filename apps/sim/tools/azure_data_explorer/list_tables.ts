import type {
  AzureDataExplorerListTablesParams,
  AzureDataExplorerTableListResponse,
} from '@/tools/azure_data_explorer/types'
import {
  azureDataExplorerAuthInput,
  transformColumnListResponse,
} from '@/tools/azure_data_explorer/utils'
import type { InternalToolConfig } from '@/tools/types'

export const azureDataExplorerListTablesTool: InternalToolConfig<
  AzureDataExplorerListTablesParams,
  AzureDataExplorerTableListResponse
> = {
  id: 'azure_data_explorer_list_tables',
  name: 'Azure Data Explorer List Tables',
  description:
    'List the tables in an Azure Data Explorer database, with their folder and docstring.',
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
      description: 'Database whose tables should be listed',
    },
  },
  operation: {
    input: (params) => ({
      ...azureDataExplorerAuthInput(params),
      endpoint: 'mgmt',
      database: params.database,
      csl: '.show tables',
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
      description: 'Table names, read from the TableName column',
      items: { type: 'string' },
    },
  },
}
