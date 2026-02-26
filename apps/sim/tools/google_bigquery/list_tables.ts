import type {
  GoogleBigQueryListTablesParams,
  GoogleBigQueryListTablesResponse,
} from '@/tools/google_bigquery/types'
import type { ToolConfig } from '@/tools/types'

export const googleBigQueryListTablesTool: ToolConfig<
  GoogleBigQueryListTablesParams,
  GoogleBigQueryListTablesResponse
> = {
  id: 'google_bigquery_list_tables',
  name: 'BigQuery List Tables',
  description: 'List all tables in a Google BigQuery dataset',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'google-bigquery',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token',
    },
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Google Cloud project ID',
    },
    datasetId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'BigQuery dataset ID',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of tables to return',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Token for pagination',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(params.projectId)}/datasets/${encodeURIComponent(params.datasetId)}/tables`
      )
      if (params.maxResults !== undefined && params.maxResults !== null) {
        const maxResults = Number(params.maxResults)
        if (Number.isFinite(maxResults) && maxResults > 0) {
          url.searchParams.set('maxResults', String(maxResults))
        }
      }
      if (params.pageToken) url.searchParams.set('pageToken', params.pageToken)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      const errorMessage = data.error?.message || 'Failed to list BigQuery tables'
      throw new Error(errorMessage)
    }

    const tables = (data.tables ?? []).map(
      (t: {
        tableReference: { tableId: string; datasetId: string; projectId: string }
        type?: string
        friendlyName?: string
        creationTime?: string
      }) => ({
        tableId: t.tableReference.tableId,
        datasetId: t.tableReference.datasetId,
        projectId: t.tableReference.projectId,
        type: t.type ?? null,
        friendlyName: t.friendlyName ?? null,
        creationTime: t.creationTime ?? null,
      })
    )

    return {
      success: true,
      output: {
        tables,
        totalItems: data.totalItems ?? null,
        nextPageToken: data.nextPageToken ?? null,
      },
    }
  },

  outputs: {
    tables: {
      type: 'array',
      description: 'Array of table objects',
      items: {
        type: 'object',
        properties: {
          tableId: { type: 'string', description: 'Table identifier' },
          datasetId: { type: 'string', description: 'Dataset ID containing this table' },
          projectId: { type: 'string', description: 'Project ID containing this table' },
          type: { type: 'string', description: 'Table type (TABLE, VIEW, EXTERNAL, etc.)' },
          friendlyName: {
            type: 'string',
            description: 'User-friendly name for the table',
            optional: true,
          },
          creationTime: {
            type: 'string',
            description: 'Time when created, in milliseconds since epoch',
            optional: true,
          },
        },
      },
    },
    totalItems: {
      type: 'number',
      description: 'Total number of tables in the dataset',
      optional: true,
    },
    nextPageToken: {
      type: 'string',
      description: 'Token for fetching next page of results',
      optional: true,
    },
  },
}
