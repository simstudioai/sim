import type {
  AzureDataExplorerShowTableSchemaParams,
  AzureDataExplorerTableSchemaResponse,
} from '@/tools/azure_data_explorer/types'
import {
  AZURE_DATA_EXPLORER_PROXY_URL,
  azureDataExplorerAuthBody,
  renderEntityName,
  transformTableSchemaResponse,
} from '@/tools/azure_data_explorer/utils'
import type { ToolConfig } from '@/tools/types'

export const azureDataExplorerShowTableSchemaTool: ToolConfig<
  AzureDataExplorerShowTableSchemaParams,
  AzureDataExplorerTableSchemaResponse
> = {
  id: 'azure_data_explorer_show_table_schema',
  name: 'Azure Data Explorer Show Table Schema',
  description:
    'Read the column schema of an Azure Data Explorer table in CSL form (e.g., "Timestamp:datetime,Level:string"). Use this before writing a KQL query against an unfamiliar table.',
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
      description: 'Table whose schema should be read',
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
      csl: `.show table ${renderEntityName(params.table)} cslschema`,
    }),
  },
  transformResponse: transformTableSchemaResponse,
  outputs: {
    tableName: { type: 'string', description: 'Name of the table', nullable: true },
    schema: {
      type: 'string',
      description: 'Comma-separated CSL column schema (name:type)',
      nullable: true,
    },
    databaseName: { type: 'string', description: "The table's database", nullable: true },
    folder: { type: 'string', description: "The table's folder", nullable: true },
    docString: { type: 'string', description: "The table's docstring", nullable: true },
  },
}
