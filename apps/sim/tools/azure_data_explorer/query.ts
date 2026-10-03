import { isRecordLike } from '@sim/utils/object'
import type {
  AzureDataExplorerQueryParams,
  AzureDataExplorerTableResponse,
} from '@/tools/azure_data_explorer/types'
import {
  azureDataExplorerAuthInput,
  transformAzureDataExplorerResponse,
} from '@/tools/azure_data_explorer/utils'
import type { InternalToolConfig } from '@/tools/types'

function parseProperties(
  input: AzureDataExplorerQueryParams['properties']
): Record<string, unknown> | undefined {
  if (input === undefined || input === null || input === '') return undefined
  if (typeof input === 'object') return input
  try {
    const parsed = JSON.parse(input)
    if (isRecordLike(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    throw new Error('Invalid properties: must be a JSON object')
  }
  throw new Error('Invalid properties: must be a JSON object')
}

export const azureDataExplorerQueryTool: InternalToolConfig<
  AzureDataExplorerQueryParams,
  AzureDataExplorerTableResponse
> = {
  id: 'azure_data_explorer_query',
  name: 'Azure Data Explorer Query',
  description:
    'Run a Kusto Query Language (KQL) query against an Azure Data Explorer database and return the primary result table.',
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
      description: 'Database to run the query against',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'KQL query text (e.g., StormEvents | where State == "FLORIDA" | summarize count() by EventType)',
    },
    properties: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Kusto request properties object, e.g. {"Options":{"servertimeout":"00:04:00","queryconsistency":"strongconsistency"}}',
    },
    readOnly: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Send x-ms-readonly so the cluster rejects any request that would change data',
    },
  },
  operation: {
    input: (params) => {
      const properties = parseProperties(params.properties)
      return {
        ...azureDataExplorerAuthInput(params),
        endpoint: 'query',
        database: params.database,
        csl: params.query,
        ...(properties ? { properties } : {}),
        ...(params.readOnly ? { readOnly: true } : {}),
      }
    },
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
