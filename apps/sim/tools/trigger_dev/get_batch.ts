import type { TriggerDevBatchIdParams, TriggerDevGetBatchResponse } from '@/tools/trigger_dev/types'
import { buildTriggerDevHeaders, TRIGGER_DEV_API_BASE } from '@/tools/trigger_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const triggerDevGetBatchTool: ToolConfig<
  TriggerDevBatchIdParams,
  TriggerDevGetBatchResponse
> = {
  id: 'trigger_dev_get_batch',
  name: 'Trigger.dev Get Batch',
  description:
    'Retrieve a Trigger.dev batch by its ID, including its status, run IDs, and success and failure counts.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Trigger.dev secret API key (starts with tr_)',
    },
    batchId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the batch to retrieve (starts with batch_)',
    },
  },

  request: {
    url: (params) =>
      `${TRIGGER_DEV_API_BASE}/api/v1/batches/${encodeURIComponent(params.batchId.trim())}`,
    method: 'GET',
    headers: (params) => buildTriggerDevHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        id: data.id,
        status: data.status,
        idempotencyKey: data.idempotencyKey ?? null,
        createdAt: data.createdAt ?? null,
        updatedAt: data.updatedAt ?? null,
        runCount: data.runCount ?? null,
        runIds: data.runs ?? [],
        successfulRunCount: data.successfulRunCount ?? null,
        failedRunCount: data.failedRunCount ?? null,
        errors: data.errors
          ? data.errors.map(
              (batchError: {
                index?: number
                taskIdentifier?: string
                error?: Record<string, unknown>
                errorCode?: string | null
              }) => ({
                index: batchError.index ?? null,
                taskIdentifier: batchError.taskIdentifier ?? null,
                error: batchError.error ?? null,
                errorCode: batchError.errorCode ?? null,
              })
            )
          : null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'ID of the batch (starts with batch_)' },
    status: {
      type: 'string',
      description: 'Batch status (PENDING, PROCESSING, COMPLETED, PARTIAL_FAILED, or ABORTED)',
    },
    idempotencyKey: {
      type: 'string',
      description: 'Idempotency key provided when triggering the batch',
      optional: true,
    },
    createdAt: {
      type: 'string',
      description: 'ISO timestamp when the batch was created',
      optional: true,
    },
    updatedAt: {
      type: 'string',
      description: 'ISO timestamp when the batch was last updated',
      optional: true,
    },
    runCount: { type: 'number', description: 'Total number of runs in the batch', optional: true },
    runIds: {
      type: 'array',
      description: 'IDs of the runs in the batch',
      items: { type: 'string', description: 'Run ID (starts with run_)' },
    },
    successfulRunCount: {
      type: 'number',
      description: 'Number of successful runs, populated after completion',
      optional: true,
    },
    failedRunCount: {
      type: 'number',
      description: 'Number of failed runs, populated after completion',
      optional: true,
    },
    errors: {
      type: 'array',
      description: 'Error details for failed items, present for PARTIAL_FAILED batches',
      optional: true,
      items: {
        type: 'object',
        description: 'Failed batch item',
        properties: {
          index: { type: 'number', description: 'Index of the failed item', nullable: true },
          taskIdentifier: {
            type: 'string',
            description: 'Task identifier of the failed item',
            nullable: true,
          },
          error: { type: 'json', description: 'Error details', nullable: true },
          errorCode: { type: 'string', description: 'Optional error code', nullable: true },
        },
      },
    },
  },
}
