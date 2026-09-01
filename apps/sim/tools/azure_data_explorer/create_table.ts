import type {
  AzureDataExplorerCreateTableParams,
  AzureDataExplorerTableResponse,
} from '@/tools/azure_data_explorer/types'
import {
  azureDataExplorerAuthInput,
  buildWithClause,
  renderColumnSchema,
  renderEntityName,
  transformAzureDataExplorerResponse,
} from '@/tools/azure_data_explorer/utils'
import type { InternalToolConfig } from '@/tools/types'

export const azureDataExplorerCreateTableTool: InternalToolConfig<
  AzureDataExplorerCreateTableParams,
  AzureDataExplorerTableResponse
> = {
  id: 'azure_data_explorer_create_table',
  name: 'Azure Data Explorer Create Table',
  description:
    'Create a table in an Azure Data Explorer database from a CSL column schema. Succeeds without changing anything if a table of the same name already exists.',
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
      description: 'Database to create the table in',
    },
    table: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the table to create',
    },
    columnSchema: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Comma-separated CSL column schema (e.g., Timestamp:datetime, Level:string, Count:long)',
    },
    tableProperties: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional table properties clause contents, e.g. docstring="Raw logs", folder="Ingest"',
    },
  },
  operation: {
    input: (params) => ({
      ...azureDataExplorerAuthInput(params),
      endpoint: 'mgmt',
      database: params.database,
      csl: `.create table ${renderEntityName(params.table)} (${renderColumnSchema(
        params.columnSchema
      )})${buildWithClause(params.tableProperties, 'docstring="Raw logs"')}`,
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
