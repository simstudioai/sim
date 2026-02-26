import type {
  GoogleBigQueryQueryParams,
  GoogleBigQueryQueryResponse,
} from '@/tools/google_bigquery/types'
import type { ToolConfig } from '@/tools/types'

export const googleBigQueryQueryTool: ToolConfig<
  GoogleBigQueryQueryParams,
  GoogleBigQueryQueryResponse
> = {
  id: 'google_bigquery_query',
  name: 'BigQuery Run Query',
  description: 'Run a SQL query against Google BigQuery and return the results',
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
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'SQL query to execute',
    },
    useLegacySql: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to use legacy SQL syntax (default: false)',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of rows to return',
    },
    defaultDatasetId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Default dataset for unqualified table names',
    },
    location: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Processing location (e.g., "US", "EU")',
    },
  },

  request: {
    url: (params) =>
      `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(params.projectId)}/queries`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        query: params.query,
        useLegacySql: params.useLegacySql ?? false,
      }
      if (params.maxResults !== undefined) body.maxResults = Number(params.maxResults)
      if (params.defaultDatasetId) {
        body.defaultDataset = {
          projectId: params.projectId,
          datasetId: params.defaultDatasetId,
        }
      }
      if (params.location) body.location = params.location
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      const errorMessage = data.error?.message || 'Failed to execute BigQuery query'
      throw new Error(errorMessage)
    }

    const columns = (data.schema?.fields ?? []).map((f: { name: string }) => f.name)
    const rows = (data.rows ?? []).map((row: { f: Array<{ v: unknown }> }) => {
      const obj: Record<string, unknown> = {}
      row.f.forEach((field, index) => {
        obj[columns[index]] = field.v ?? null
      })
      return obj
    })

    return {
      success: true,
      output: {
        columns,
        rows,
        totalRows: data.totalRows ?? null,
        jobComplete: data.jobComplete ?? false,
        totalBytesProcessed: data.totalBytesProcessed ?? null,
        cacheHit: data.cacheHit ?? null,
        jobReference: data.jobReference ?? null,
        pageToken: data.pageToken ?? null,
      },
    }
  },

  outputs: {
    columns: {
      type: 'array',
      description: 'Array of column names from the query result',
      items: { type: 'string', description: 'Column name' },
    },
    rows: {
      type: 'array',
      description: 'Array of row objects keyed by column name',
      items: {
        type: 'object',
        description: 'Row with column name/value pairs',
      },
    },
    totalRows: {
      type: 'string',
      description: 'Total number of rows in the complete result set',
      optional: true,
    },
    jobComplete: { type: 'boolean', description: 'Whether the query completed within the timeout' },
    totalBytesProcessed: { type: 'string', description: 'Total bytes processed by the query' },
    cacheHit: {
      type: 'boolean',
      description: 'Whether the query result was served from cache',
      optional: true,
    },
    jobReference: {
      type: 'object',
      description: 'Job reference (useful when jobComplete is false)',
      optional: true,
      properties: {
        projectId: { type: 'string', description: 'Project ID containing the job' },
        jobId: { type: 'string', description: 'Unique job identifier' },
        location: { type: 'string', description: 'Geographic location of the job' },
      },
    },
    pageToken: {
      type: 'string',
      description: 'Token for fetching additional result pages',
      optional: true,
    },
  },
}
