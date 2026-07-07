import type {
  GoogleBigQueryCreateDatasetParams,
  GoogleBigQueryCreateDatasetResponse,
} from '@/tools/google_bigquery/types'
import type { ToolConfig } from '@/tools/types'

export const googleBigQueryCreateDatasetTool: ToolConfig<
  GoogleBigQueryCreateDatasetParams,
  GoogleBigQueryCreateDatasetResponse
> = {
  id: 'google_bigquery_create_dataset',
  name: 'BigQuery Create Dataset',
  description: 'Create a new dataset in a Google BigQuery project',
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
      description: 'ID for the new BigQuery dataset',
    },
    location: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Geographic location for the dataset (e.g., "US", "EU")',
    },
    friendlyName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Human-readable name for the dataset',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the dataset',
    },
  },

  request: {
    url: (params) =>
      `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(params.projectId)}/datasets`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        datasetReference: {
          projectId: params.projectId,
          datasetId: params.datasetId,
        },
      }
      if (params.location) body.location = params.location
      if (params.friendlyName) body.friendlyName = params.friendlyName
      if (params.description) body.description = params.description
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      const errorMessage = data.error?.message || 'Failed to create BigQuery dataset'
      throw new Error(errorMessage)
    }

    return {
      success: true,
      output: {
        datasetId: data.datasetReference?.datasetId ?? null,
        projectId: data.datasetReference?.projectId ?? null,
        friendlyName: data.friendlyName ?? null,
        description: data.description ?? null,
        location: data.location ?? null,
        creationTime: data.creationTime ?? null,
      },
    }
  },

  outputs: {
    datasetId: { type: 'string', description: 'Unique dataset identifier' },
    projectId: { type: 'string', description: 'Project ID containing this dataset' },
    friendlyName: {
      type: 'string',
      description: 'Descriptive name for the dataset',
      optional: true,
    },
    description: { type: 'string', description: 'Dataset description', optional: true },
    location: {
      type: 'string',
      description: 'Geographic location where the data resides',
      optional: true,
    },
    creationTime: {
      type: 'string',
      description: 'Dataset creation time (milliseconds since epoch)',
      optional: true,
    },
  },
}
