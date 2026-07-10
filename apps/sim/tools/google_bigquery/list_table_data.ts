import type {
  GoogleBigQueryListTableDataParams,
  GoogleBigQueryListTableDataResponse,
} from '@/tools/google_bigquery/types'
import type { ToolConfig } from '@/tools/types'

export const googleBigQueryListTableDataTool: ToolConfig<
  GoogleBigQueryListTableDataParams,
  GoogleBigQueryListTableDataResponse
> = {
  id: 'google_bigquery_list_table_data',
  name: 'BigQuery List Table Data',
  description:
    'Preview rows from a Google BigQuery table without running a query. Pair with Get Table to know the column order.',
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
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of rows to return',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Token for pagination',
    },
    startIndex: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Zero-based index of the starting row',
    },
    selectedFields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of column names to return',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(params.projectId)}/datasets/${encodeURIComponent(params.datasetId.trim())}/tables/${encodeURIComponent(params.tableId.trim())}/data`
      )
      if (params.maxResults !== undefined && params.maxResults !== null) {
        const maxResults = Number(params.maxResults)
        if (Number.isFinite(maxResults) && maxResults > 0) {
          url.searchParams.set('maxResults', String(maxResults))
        }
      }
      if (params.pageToken) url.searchParams.set('pageToken', params.pageToken)
      if (params.startIndex) url.searchParams.set('startIndex', params.startIndex)
      if (params.selectedFields) url.searchParams.set('selectedFields', params.selectedFields)
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
      const errorMessage = data.error?.message || 'Failed to list BigQuery table data'
      throw new Error(errorMessage)
    }

    const rows = (data.rows ?? []).map((row: { f: Array<{ v: unknown }> }) =>
      row.f.map((field) => field.v ?? null)
    )

    return {
      success: true,
      output: {
        rows,
        totalRows: data.totalRows ?? null,
        pageToken: data.pageToken ?? null,
      },
    }
  },

  outputs: {
    rows: {
      type: 'array',
      description: 'Array of rows, each a raw array of column values in schema order',
      items: { type: 'array', description: 'Row values in column order' },
    },
    totalRows: {
      type: 'string',
      description: 'Total number of rows in the table',
      optional: true,
    },
    pageToken: {
      type: 'string',
      description: 'Token for fetching the next page of results',
      optional: true,
    },
  },
}
