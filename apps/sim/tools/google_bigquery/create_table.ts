import type {
  GoogleBigQueryCreateTableParams,
  GoogleBigQueryCreateTableResponse,
} from '@/tools/google_bigquery/types'
import type { ToolConfig } from '@/tools/types'

export const googleBigQueryCreateTableTool: ToolConfig<
  GoogleBigQueryCreateTableParams,
  GoogleBigQueryCreateTableResponse
> = {
  id: 'google_bigquery_create_table',
  name: 'BigQuery Create Table',
  description: 'Create a new table in a Google BigQuery dataset',
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
      description: 'ID for the new BigQuery table',
    },
    schema: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON array of column field definitions, e.g. [{"name":"id","type":"STRING","mode":"REQUIRED"}]',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the table',
    },
    friendlyName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Human-readable name for the table',
    },
  },

  request: {
    url: (params) =>
      `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(params.projectId)}/datasets/${encodeURIComponent(params.datasetId.trim())}/tables`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const fields = typeof params.schema === 'string' ? JSON.parse(params.schema) : params.schema

      const body: Record<string, unknown> = {
        tableReference: {
          projectId: params.projectId,
          datasetId: params.datasetId,
          tableId: params.tableId,
        },
        schema: { fields },
      }
      if (params.description) body.description = params.description
      if (params.friendlyName) body.friendlyName = params.friendlyName
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      const errorMessage = data.error?.message || 'Failed to create BigQuery table'
      throw new Error(errorMessage)
    }

    const schema = (data.schema?.fields ?? []).map(
      (f: { name: string; type: string; mode?: string; description?: string }) => ({
        name: f.name,
        type: f.type,
        mode: f.mode ?? null,
        description: f.description ?? null,
      })
    )

    return {
      success: true,
      output: {
        tableId: data.tableReference?.tableId ?? null,
        datasetId: data.tableReference?.datasetId ?? null,
        projectId: data.tableReference?.projectId ?? null,
        type: data.type ?? null,
        description: data.description ?? null,
        schema,
        creationTime: data.creationTime ?? null,
        location: data.location ?? null,
      },
    }
  },

  outputs: {
    tableId: { type: 'string', description: 'Table ID' },
    datasetId: { type: 'string', description: 'Dataset ID' },
    projectId: { type: 'string', description: 'Project ID' },
    type: { type: 'string', description: 'Table type (usually TABLE)', optional: true },
    description: { type: 'string', description: 'Table description', optional: true },
    schema: {
      type: 'array',
      description: 'Array of column definitions',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Column name' },
          type: { type: 'string', description: 'Data type' },
          mode: {
            type: 'string',
            description: 'Column mode (NULLABLE, REQUIRED, or REPEATED)',
            optional: true,
          },
          description: { type: 'string', description: 'Column description', optional: true },
        },
      },
    },
    creationTime: {
      type: 'string',
      description: 'Table creation time (milliseconds since epoch)',
      optional: true,
    },
    location: {
      type: 'string',
      description: 'Geographic location where the table resides',
      optional: true,
    },
  },
}
