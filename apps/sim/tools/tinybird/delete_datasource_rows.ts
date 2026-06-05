import { createLogger } from '@sim/logger'
import type {
  TinybirdDeleteDatasourceRowsParams,
  TinybirdDeleteDatasourceRowsResponse,
} from '@/tools/tinybird/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('tinybird-delete-datasource-rows')

/**
 * Tinybird Delete Data Source Rows Tool
 *
 * Deletes rows from a Data Source that match a SQL condition. This is asynchronous
 * and returns a delete job that can be polled for completion. Set `dry_run` to test
 * the condition without deleting any data.
 */
export const deleteDatasourceRowsTool: ToolConfig<
  TinybirdDeleteDatasourceRowsParams,
  TinybirdDeleteDatasourceRowsResponse
> = {
  id: 'tinybird_delete_datasource_rows',
  name: 'Tinybird Delete Data Source Rows',
  description: 'Delete rows from a Tinybird Data Source matching a SQL condition.',
  version: '1.0.0',
  errorExtractor: 'nested-error-object',

  params: {
    base_url: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Tinybird API base URL (e.g., https://api.tinybird.co)',
    },
    datasource: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the Data Source to delete rows from. Example: "events_raw"',
    },
    delete_condition: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'SQL WHERE-clause condition selecting the rows to delete. Example: "country = \'ES\'" or "event_date < \'2024-01-01\'"',
    },
    dry_run: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description:
        'When true, returns how many rows would be deleted without deleting them. Defaults to false.',
    },
    token: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Tinybird API Token with DATASOURCES:CREATE scope',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.base_url.trim().replace(/\/+$/, '')
      return `${baseUrl}/v0/datasources/${encodeURIComponent(params.datasource.trim())}/delete`
    },
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Bearer ${params.token.trim()}`,
    }),
    body: (params) => {
      const searchParams = new URLSearchParams()
      searchParams.set('delete_condition', params.delete_condition.trim())
      if (params.dry_run) {
        searchParams.set('dry_run', 'true')
      }
      return searchParams.toString()
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    logger.info('Started Tinybird delete-by-condition job', {
      deleteId: data.delete_id,
      status: data.status ?? data.job?.status,
    })

    return {
      success: true,
      output: {
        id: data.id ?? null,
        job_id: data.job_id ?? data.job?.job_id ?? data.job?.id ?? null,
        delete_id: data.delete_id ?? null,
        job_url: data.job_url ?? data.job?.job_url ?? null,
        status: data.status ?? data.job?.status ?? null,
        job: data.job ?? null,
      },
    }
  },

  outputs: {
    id: {
      type: 'string',
      description: 'Identifier of the delete operation',
      optional: true,
    },
    job_id: {
      type: 'string',
      description: 'Job identifier used to poll delete status',
      optional: true,
    },
    delete_id: {
      type: 'string',
      description: 'Deletion identifier',
      optional: true,
    },
    job_url: {
      type: 'string',
      description: 'URL to query the delete job status',
      optional: true,
    },
    status: {
      type: 'string',
      description: 'Current job status (e.g., "waiting", "done")',
      optional: true,
    },
    job: {
      type: 'json',
      description:
        'Full delete job details (kind, id, status, delete_condition, rows_affected, ...)',
      optional: true,
    },
  },
}
