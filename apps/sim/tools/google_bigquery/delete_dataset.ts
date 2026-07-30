import type {
  GoogleBigQueryDeleteDatasetParams,
  GoogleBigQueryDeleteDatasetResponse,
} from '@/tools/google_bigquery/types'
import type { ToolConfig } from '@/tools/types'

export const googleBigQueryDeleteDatasetTool: ToolConfig<
  GoogleBigQueryDeleteDatasetParams,
  GoogleBigQueryDeleteDatasetResponse
> = {
  id: 'google_bigquery_delete_dataset',
  name: 'BigQuery Delete Dataset',
  description: 'Delete a dataset from a Google BigQuery project',
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
      description: 'BigQuery dataset ID to delete',
    },
    deleteContents: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to delete tables inside the dataset (default: false)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(params.projectId)}/datasets/${encodeURIComponent(params.datasetId.trim())}`
      )
      if (params.deleteContents !== undefined) {
        url.searchParams.set('deleteContents', String(params.deleteContents))
      }
      return url.toString()
    },
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      const errorMessage = data.error?.message || 'Failed to delete BigQuery dataset'
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
    deleted: { type: 'boolean', description: 'Whether the dataset was deleted' },
  },
}
