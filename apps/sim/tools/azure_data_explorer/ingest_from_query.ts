import type {
  AzureDataExplorerIngestFromQueryParams,
  AzureDataExplorerTableResponse,
} from '@/tools/azure_data_explorer/types'
import {
  AZURE_DATA_EXPLORER_PROXY_URL,
  azureDataExplorerAuthBody,
  buildWithClause,
  renderEntityName,
  renderIngestMode,
  transformAzureDataExplorerResponse,
} from '@/tools/azure_data_explorer/utils'
import type { ToolConfig } from '@/tools/types'

export const azureDataExplorerIngestFromQueryTool: ToolConfig<
  AzureDataExplorerIngestFromQueryParams,
  AzureDataExplorerTableResponse
> = {
  id: 'azure_data_explorer_ingest_from_query',
  name: 'Azure Data Explorer Ingest From Query',
  description:
    "Materialize the result of a KQL query into a table with .set, .append, .set-or-append, or .set-or-replace. Use this to build rollup or summary tables instead of pushing rows from a workflow. Kusto matches the query result to the target table by column type and position, NOT by column name, so project the columns in exactly the table's order or the data lands in the wrong columns.",
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
      description: 'Database containing the target table',
    },
    table: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Table to ingest the query result into',
    },
    mode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'set (create, fail if it exists), append (add to an existing table), set-or-append (default), or set-or-replace (replace all data)',
    },
    sourceQuery: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'KQL query whose result becomes the ingested data (e.g., LogsTable | where Level == "Error" | where Timestamp > ago(1h)). Project the columns in the target table\'s order — matching is positional, not by name',
    },
    async: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Return immediately with an OperationId and keep ingesting in the background. Check progress with Show Operations',
    },
    ingestionProperties: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: `Optional ingestion properties clause contents, e.g. distributed=true, tags='["daily"]'`,
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
      csl: `${renderIngestMode(params.mode)}${params.async ? ' async' : ''} ${renderEntityName(
        params.table
      )}${buildWithClause(params.ingestionProperties, 'distributed=true')} <|\n${params.sourceQuery}`,
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
