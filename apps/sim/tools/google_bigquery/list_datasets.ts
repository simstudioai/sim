import type {
  GoogleBigQueryListDatasetsParams,
  GoogleBigQueryListDatasetsResponse,
} from '@/tools/google_bigquery/types'
import type { ToolConfig } from '@/tools/types'

export const googleBigQueryListDatasetsTool: ToolConfig<
  GoogleBigQueryListDatasetsParams,
  GoogleBigQueryListDatasetsResponse
> = {
  id: 'google_bigquery_list_datasets',
  name: 'BigQuery List Datasets',
  description: 'List all datasets in a Google BigQuery project',
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
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of datasets to return',
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
        `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(params.projectId)}/datasets`
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
      const errorMessage = data.error?.message || 'Failed to list BigQuery datasets'
      throw new Error(errorMessage)
    }

    const datasets = (data.datasets ?? []).map(
      (ds: {
        datasetReference: { datasetId: string; projectId: string }
        friendlyName?: string
        location?: string
      }) => ({
        datasetId: ds.datasetReference.datasetId,
        projectId: ds.datasetReference.projectId,
        friendlyName: ds.friendlyName ?? null,
        location: ds.location ?? null,
      })
    )

    return {
      success: true,
      output: {
        datasets,
        nextPageToken: data.nextPageToken ?? null,
      },
    }
  },

  outputs: {
    datasets: {
      type: 'array',
      description: 'Array of dataset objects',
      items: {
        type: 'object',
        properties: {
          datasetId: { type: 'string', description: 'Unique dataset identifier' },
          projectId: { type: 'string', description: 'Project ID containing this dataset' },
          friendlyName: {
            type: 'string',
            description: 'Descriptive name for the dataset',
            optional: true,
          },
          location: { type: 'string', description: 'Geographic location where the data resides' },
        },
      },
    },
    nextPageToken: {
      type: 'string',
      description: 'Token for fetching next page of results',
      optional: true,
    },
  },
}
