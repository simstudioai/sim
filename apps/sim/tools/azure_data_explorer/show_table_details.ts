import type {
  AzureDataExplorerShowTableDetailsParams,
  AzureDataExplorerTableResponse,
} from '@/tools/azure_data_explorer/types'
import {
  azureDataExplorerAuthInput,
  renderEntityName,
  transformAzureDataExplorerResponse,
} from '@/tools/azure_data_explorer/utils'
import type { InternalToolConfig } from '@/tools/types'

export const azureDataExplorerShowTableDetailsTool: InternalToolConfig<
  AzureDataExplorerShowTableDetailsParams,
  AzureDataExplorerTableResponse
> = {
  id: 'azure_data_explorer_show_table_details',
  name: 'Azure Data Explorer Show Table Details',
  description:
    'Read size, row count, hot-cache footprint, and effective policies for a table — or for every table in the database when no table is given. Use it to see how much data a table actually holds before querying it.',
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
      description: 'Database to read table details from',
    },
    table: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Table to describe. Omit to describe every table in the database',
    },
  },
  operation: {
    input: (params) => ({
      ...azureDataExplorerAuthInput(params),
      endpoint: 'mgmt',
      database: params.database,
      csl: params.table
        ? `.show table ${renderEntityName(params.table)} details`
        : '.show tables details',
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
