import type {
  GoogleBigQueryGetQueryResultsParams,
  GoogleBigQueryGetQueryResultsResponse,
} from '@/tools/google_bigquery/types'
import type { ToolConfig } from '@/tools/types'

export const googleBigQueryGetQueryResultsTool: ToolConfig<
  GoogleBigQueryGetQueryResultsParams,
  GoogleBigQueryGetQueryResultsResponse
> = {
  id: 'google_bigquery_get_query_results',
  name: 'BigQuery Get Query Results',
  description:
    'Fetch results for a previously submitted BigQuery job, or the next page of a Run Query result',
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
    jobId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the BigQuery job to fetch results for',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Token for pagination',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of rows to return',
    },
    timeoutMs: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'How long to wait for the job to complete, in milliseconds',
    },
    location: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Processing location of the job (e.g., "US", "EU")',
    },
    startIndex: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Zero-based index of the starting row',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(params.projectId)}/queries/${encodeURIComponent(params.jobId.trim())}`
      )
      if (params.pageToken) url.searchParams.set('pageToken', params.pageToken)
      if (params.maxResults !== undefined && params.maxResults !== null) {
        const maxResults = Number(params.maxResults)
        if (Number.isFinite(maxResults) && maxResults > 0) {
          url.searchParams.set('maxResults', String(maxResults))
        }
      }
      if (params.timeoutMs !== undefined && params.timeoutMs !== null) {
        const timeoutMs = Number(params.timeoutMs)
        if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
          url.searchParams.set('timeoutMs', String(timeoutMs))
        }
      }
      if (params.location) url.searchParams.set('location', params.location)
      if (params.startIndex) url.searchParams.set('startIndex', params.startIndex)
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
      const errorMessage = data.error?.message || 'Failed to fetch BigQuery query results'
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
    jobComplete: { type: 'boolean', description: 'Whether the job has completed' },
    totalBytesProcessed: {
      type: 'string',
      description: 'Total bytes processed by the query',
      optional: true,
    },
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
