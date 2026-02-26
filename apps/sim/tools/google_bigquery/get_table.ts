import type {
  GoogleBigQueryGetTableParams,
  GoogleBigQueryGetTableResponse,
} from '@/tools/google_bigquery/types'
import type { ToolConfig } from '@/tools/types'

export const googleBigQueryGetTableTool: ToolConfig<
  GoogleBigQueryGetTableParams,
  GoogleBigQueryGetTableResponse
> = {
  id: 'google_bigquery_get_table',
  name: 'BigQuery Get Table',
  description: 'Get metadata and schema for a Google BigQuery table',
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
      description: 'BigQuery table ID',
    },
  },

  request: {
    url: (params) =>
      `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(params.projectId)}/datasets/${encodeURIComponent(params.datasetId)}/tables/${encodeURIComponent(params.tableId)}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      const errorMessage = data.error?.message || 'Failed to get BigQuery table'
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
        numRows: data.numRows ?? null,
        numBytes: data.numBytes ?? null,
        schema,
        creationTime: data.creationTime ?? null,
        lastModifiedTime: data.lastModifiedTime ?? null,
        location: data.location ?? null,
      },
    }
  },

  outputs: {
    tableId: { type: 'string', description: 'Table ID' },
    datasetId: { type: 'string', description: 'Dataset ID' },
    projectId: { type: 'string', description: 'Project ID' },
    type: {
      type: 'string',
      description: 'Table type (TABLE, VIEW, SNAPSHOT, MATERIALIZED_VIEW, EXTERNAL)',
    },
    description: { type: 'string', description: 'Table description', optional: true },
    numRows: { type: 'string', description: 'Total number of rows' },
    numBytes: {
      type: 'string',
      description: 'Total size in bytes, excluding data in streaming buffer',
    },
    schema: {
      type: 'array',
      description: 'Array of column definitions',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Column name' },
          type: {
            type: 'string',
            description: 'Data type (STRING, INTEGER, FLOAT, BOOLEAN, TIMESTAMP, RECORD, etc.)',
          },
          mode: {
            type: 'string',
            description: 'Column mode (NULLABLE, REQUIRED, or REPEATED)',
            optional: true,
          },
          description: { type: 'string', description: 'Column description', optional: true },
        },
      },
    },
    creationTime: { type: 'string', description: 'Table creation time (milliseconds since epoch)' },
    lastModifiedTime: {
      type: 'string',
      description: 'Last modification time (milliseconds since epoch)',
    },
    location: { type: 'string', description: 'Geographic location where the table resides' },
  },
}
