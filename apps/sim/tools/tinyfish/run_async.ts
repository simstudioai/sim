import type { TinyFishRunAsyncParams, TinyFishRunAsyncResponse } from '@/tools/tinyfish/types'
import {
  AUTOMATION_TOOL_PARAMS,
  buildAutomationBody,
  selectAutomationModelInput,
  TINYFISH_AGENT_API_BASE,
  tinyfishErrorMessage,
  tinyfishHeaders,
} from '@/tools/tinyfish/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * Starts a run without waiting for it.
 *
 * This tool has no `hosting` config: the wallet charge lands on steps the run
 * takes after the request returns, so a hosted key could never be metered
 * against it. Callers must bring their own TinyFish API key.
 */
export const runAsyncTool: ToolConfig<TinyFishRunAsyncParams, TinyFishRunAsyncResponse> = {
  id: 'tinyfish_run_async',
  name: 'TinyFish Start Agent Run',
  description:
    'Queue a TinyFish web agent run and return its run ID immediately, without waiting for the automation to finish',
  version: '1.0.0',

  params: {
    ...AUTOMATION_TOOL_PARAMS,
    webhookUrl: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'HTTPS URL notified when the run completes, fails, or is cancelled',
    },
  },

  request: {
    url: `${TINYFISH_AGENT_API_BASE}/v1/automation/run-async`,
    method: 'POST',
    headers: (params) => tinyfishHeaders(params.apiKey),
    body: (params) => buildAutomationBody(params),
    modelInput: {
      mode: 'project',
      select: selectAutomationModelInput,
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(await tinyfishErrorMessage(response))
    }

    const data = await response.json()

    return {
      success: !data.error,
      output: { runId: data.run_id ?? null },
      error: data.error?.message,
    }
  },

  outputs: {
    runId: {
      type: 'string',
      description: 'Identifier of the queued run, used to poll or cancel it',
      optional: true,
    },
  },
}
