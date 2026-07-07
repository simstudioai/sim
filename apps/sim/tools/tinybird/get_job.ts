import { createLogger } from '@sim/logger'
import type { TinybirdGetJobParams, TinybirdGetJobResponse } from '@/tools/tinybird/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('tinybird-get-job')

/**
 * Tinybird Get Job Tool
 *
 * Polls the status of an asynchronous job (import, delete, populate, copy) by ID.
 * Used to check on jobs started by the Append Data Source and Delete Data Source Rows
 * operations, which return a job_id but do not wait for completion.
 */
export const getJobTool: ToolConfig<TinybirdGetJobParams, TinybirdGetJobResponse> = {
  id: 'tinybird_get_job',
  name: 'Tinybird Get Job',
  description: 'Check the status of an asynchronous Tinybird job (import, delete, etc.) by ID.',
  version: '1.0.0',
  errorExtractor: 'nested-error-object',

  params: {
    base_url: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Tinybird API base URL (e.g., https://api.tinybird.co)',
    },
    job_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the job to check, as returned by an append or delete operation',
    },
    token: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Tinybird API Token with ADMIN scope, or the token that started the job',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.base_url.trim().replace(/\/+$/, '')
      return `${baseUrl}/v0/jobs/${encodeURIComponent(params.job_id.trim())}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.token.trim()}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    logger.info('Fetched Tinybird job status', {
      jobId: data.job_id ?? data.id,
      kind: data.kind,
      status: data.status,
    })

    return {
      success: true,
      output: {
        id: data.id ?? null,
        job_id: data.job_id ?? data.id ?? null,
        kind: data.kind ?? null,
        status: data.status ?? null,
        job_url: data.job_url ?? null,
        created_at: data.created_at ?? null,
        started_at: data.started_at ?? null,
        updated_at: data.updated_at ?? null,
        is_cancellable: data.is_cancellable ?? null,
        error: data.error ?? null,
        job: data,
      },
    }
  },

  outputs: {
    id: {
      type: 'string',
      description: 'Job identifier',
      optional: true,
    },
    job_id: {
      type: 'string',
      description: 'Job identifier (same as id)',
      optional: true,
    },
    kind: {
      type: 'string',
      description: 'Job kind (e.g., "import", "delete_data", "populateview", "copy")',
      optional: true,
    },
    status: {
      type: 'string',
      description: 'Current job status: "waiting", "working", "done", "error", or "cancelled"',
      optional: true,
    },
    job_url: {
      type: 'string',
      description: 'URL to re-query this job status',
      optional: true,
    },
    created_at: {
      type: 'string',
      description: 'Timestamp the job was created',
      optional: true,
    },
    started_at: {
      type: 'string',
      description: 'Timestamp the job started running',
      optional: true,
    },
    updated_at: {
      type: 'string',
      description: 'Timestamp of the last job status update',
      optional: true,
    },
    is_cancellable: {
      type: 'boolean',
      description: 'Whether the job can still be cancelled',
      optional: true,
    },
    error: {
      type: 'string',
      description: 'Error message, present only when status is "error"',
      optional: true,
    },
    job: {
      type: 'json',
      description:
        'Full raw job details, including kind-specific fields (statistics, datasource, delete_condition, etc.)',
      optional: true,
    },
  },
}
