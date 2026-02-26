import type {
  GoogleBigQueryInsertRowsParams,
  GoogleBigQueryInsertRowsResponse,
} from '@/tools/google_bigquery/types'
import type { ToolConfig } from '@/tools/types'

export const googleBigQueryInsertRowsTool: ToolConfig<
  GoogleBigQueryInsertRowsParams,
  GoogleBigQueryInsertRowsResponse
> = {
  id: 'google_bigquery_insert_rows',
  name: 'BigQuery Insert Rows',
  description: 'Insert rows into a Google BigQuery table using streaming insert',
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
    rows: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'JSON array of row objects to insert',
    },
    skipInvalidRows: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to insert valid rows even if some are invalid',
    },
    ignoreUnknownValues: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to ignore columns not in the table schema',
    },
  },

  request: {
    url: (params) =>
      `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(params.projectId)}/datasets/${encodeURIComponent(params.datasetId)}/tables/${encodeURIComponent(params.tableId)}/insertAll`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const parsedRows = typeof params.rows === 'string' ? JSON.parse(params.rows) : params.rows
      const rows = (parsedRows as Record<string, unknown>[]).map(
        (row: Record<string, unknown>) => ({ json: row })
      )

      const body: Record<string, unknown> = { rows }
      if (params.skipInvalidRows !== undefined) body.skipInvalidRows = params.skipInvalidRows
      if (params.ignoreUnknownValues !== undefined)
        body.ignoreUnknownValues = params.ignoreUnknownValues

      return body
    },
  },

  transformResponse: async (response: Response, params?: GoogleBigQueryInsertRowsParams) => {
    const data = await response.json()
    if (!response.ok) {
      const errorMessage = data.error?.message || 'Failed to insert rows into BigQuery table'
      throw new Error(errorMessage)
    }

    const insertErrors = data.insertErrors ?? []
    const errors = insertErrors.map(
      (err: {
        index: number
        errors: Array<{ reason?: string; location?: string; message?: string }>
      }) => ({
        index: err.index,
        errors: err.errors.map((e) => ({
          reason: e.reason ?? null,
          location: e.location ?? null,
          message: e.message ?? null,
        })),
      })
    )

    let totalRows = 0
    if (params?.rows) {
      const parsed = typeof params.rows === 'string' ? JSON.parse(params.rows) : params.rows
      totalRows = Array.isArray(parsed) ? parsed.length : 0
    }

    // When insertErrors is empty, all rows succeeded.
    // When insertErrors is present and skipInvalidRows is false (default),
    // the entire batch is rejected — no rows are inserted.
    let insertedRows = 0
    if (insertErrors.length === 0) {
      insertedRows = totalRows
    } else if (params?.skipInvalidRows) {
      const failedIndexes = new Set(insertErrors.map((e: { index: number }) => e.index))
      insertedRows = totalRows - failedIndexes.size
    }

    return {
      success: true,
      output: {
        insertedRows,
        errors,
      },
    }
  },

  outputs: {
    insertedRows: { type: 'number', description: 'Number of rows successfully inserted' },
    errors: {
      type: 'array',
      description: 'Array of per-row insertion errors (empty if all succeeded)',
      items: {
        type: 'object',
        properties: {
          index: { type: 'number', description: 'Zero-based index of the row that failed' },
          errors: {
            type: 'array',
            description: 'Error details for this row',
            items: {
              type: 'object',
              properties: {
                reason: {
                  type: 'string',
                  description: 'Short error code summarizing the error',
                  optional: true,
                },
                location: {
                  type: 'string',
                  description: 'Where the error occurred',
                  optional: true,
                },
                message: {
                  type: 'string',
                  description: 'Human-readable error description',
                  optional: true,
                },
              },
            },
          },
        },
      },
    },
  },
}
