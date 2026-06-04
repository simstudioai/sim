import { createLogger } from '@sim/logger'
import type {
  TinybirdAppendDatasourceParams,
  TinybirdAppendDatasourceResponse,
} from '@/tools/tinybird/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('tinybird-append-datasource')

/**
 * Tinybird Append Data Source Tool
 *
 * Appends data to an existing Data Source from a remote file URL using the
 * Data Sources API (`mode=append`). This is asynchronous and returns an import
 * job that can be polled for completion.
 */
export const appendDatasourceTool: ToolConfig<
  TinybirdAppendDatasourceParams,
  TinybirdAppendDatasourceResponse
> = {
  id: 'tinybird_append_datasource',
  name: 'Tinybird Append Data Source',
  description:
    'Append data to a Tinybird Data Source from a remote file URL (CSV, NDJSON, Parquet).',
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
      description: 'Name of the existing Data Source to append to. Example: "events_raw"',
    },
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Publicly accessible URL of the file to append. Example: "https://example.com/data.csv"',
    },
    format: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Format of the source file: "csv" (default), "ndjson", or "parquet"',
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
      return `${baseUrl}/v0/datasources`
    },
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Bearer ${params.token.trim()}`,
    }),
    body: (params) => {
      const searchParams = new URLSearchParams()
      searchParams.set('mode', 'append')
      searchParams.set('name', params.datasource.trim())
      searchParams.set('url', params.url.trim())
      if (params.format) {
        searchParams.set('format', params.format)
      }
      return searchParams.toString()
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    logger.info('Started Tinybird append-from-URL import', {
      importId: data.import_id ?? data.job?.import_id,
      status: data.status ?? data.job?.status,
    })

    return {
      success: true,
      output: {
        id: data.id ?? null,
        import_id: data.import_id ?? data.job?.import_id ?? null,
        job_id: data.job_id ?? data.job?.job_id ?? data.job?.id ?? null,
        job_url: data.job_url ?? data.job?.job_url ?? null,
        status: data.status ?? data.job?.status ?? null,
        job: data.job ?? null,
        datasource: data.datasource ?? data.job?.datasource ?? null,
      },
    }
  },

  outputs: {
    id: {
      type: 'string',
      description: 'Identifier of the append operation',
      optional: true,
    },
    import_id: {
      type: 'string',
      description: 'Import identifier for the append job',
      optional: true,
    },
    job_id: {
      type: 'string',
      description: 'Job identifier used to poll import status',
      optional: true,
    },
    job_url: {
      type: 'string',
      description: 'URL to query the import job status',
      optional: true,
    },
    status: {
      type: 'string',
      description: 'Initial job status (e.g., "waiting")',
      optional: true,
    },
    job: {
      type: 'json',
      description: 'Full import job details (kind, id, status, created_at, datasource, ...)',
      optional: true,
    },
    datasource: {
      type: 'json',
      description: 'Target Data Source metadata (id, name, ...)',
      optional: true,
    },
  },
}
