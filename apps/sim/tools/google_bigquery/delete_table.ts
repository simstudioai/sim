import type {
  GoogleBigQueryDeleteTableParams,
  GoogleBigQueryDeleteTableResponse,
} from '@/tools/google_bigquery/types'
import type { ToolConfig } from '@/tools/types'

export const googleBigQueryDeleteTableTool: ToolConfig<
  GoogleBigQueryDeleteTableParams,
  GoogleBigQueryDeleteTableResponse
> = {
  id: 'google_bigquery_delete_table',
  name: 'BigQuery Delete Table',
  description: 'Delete a table from a Google BigQuery dataset',
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
    tableId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'BigQuery table ID to delete',
    },
  },

  request: {
    url: (params) =>
      `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(params.projectId)}/datasets/${encodeURIComponent(params.datasetId.trim())}/tables/${encodeURIComponent(params.tableId.trim())}`,
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      const errorMessage = data.error?.message || 'Failed to delete BigQuery table'
      throw new Error(errorMessage)
    }

    return {
      success: true,
      output: {
        deleted: true,
      },
    }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the table was deleted' },
  },
}
