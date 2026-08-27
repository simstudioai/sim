import type { TinyFishCancelRunParams, TinyFishCancelRunResponse } from '@/tools/tinyfish/types'
import {
  TINYFISH_AGENT_API_BASE,
  tinyfishErrorMessage,
  tinyfishHeaders,
} from '@/tools/tinyfish/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * Cancels a queued or running automation.
 *
 * TinyFish can only cancel runs started through the async or SSE endpoints; a
 * run started synchronously has no cancellable handle.
 */
export const cancelRunTool: ToolConfig<TinyFishCancelRunParams, TinyFishCancelRunResponse> = {
  id: 'tinyfish_cancel_run',
  name: 'TinyFish Cancel Run',
  description: 'Cancel a queued or in-progress TinyFish automation run by its ID',
  version: '1.0.0',

  params: {
    runId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Identifier of the run to cancel',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'TinyFish API key',
    },
  },

  request: {
    url: (params) =>
      `${TINYFISH_AGENT_API_BASE}/v1/runs/${encodeURIComponent(params.runId.trim())}/cancel`,
    method: 'POST',
    headers: (params) => tinyfishHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(await tinyfishErrorMessage(response))
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        runId: data.run_id ?? '',
        status: data.status,
        cancelledAt: data.cancelled_at ?? null,
        message: data.message ?? null,
      },
    }
  },

  outputs: {
    runId: { type: 'string', description: 'Run identifier' },
    status: {
      type: 'string',
      description:
        'Status after the call: CANCELLED, or the terminal status the run already reached',
    },
    cancelledAt: {
      type: 'string',
      description: 'ISO 8601 timestamp of the cancellation, null when nothing was cancelled',
      optional: true,
    },
    message: {
      type: 'string',
      description: 'Context such as "Run already cancelled" or "Run already finished"',
      optional: true,
    },
  },
}
