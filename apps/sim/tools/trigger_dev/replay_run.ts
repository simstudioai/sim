import type { TriggerDevRunActionResponse, TriggerDevRunIdParams } from '@/tools/trigger_dev/types'
import { buildTriggerDevHeaders, TRIGGER_DEV_API_BASE } from '@/tools/trigger_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const triggerDevReplayRunTool: ToolConfig<
  TriggerDevRunIdParams,
  TriggerDevRunActionResponse
> = {
  id: 'trigger_dev_replay_run',
  name: 'Trigger.dev Replay Run',
  description:
    'Replay a Trigger.dev run, creating a new run with the same payload and options as the original.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Trigger.dev secret API key (starts with tr_)',
    },
    runId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the run to replay (starts with run_)',
    },
  },

  request: {
    url: (params) =>
      `${TRIGGER_DEV_API_BASE}/api/v1/runs/${encodeURIComponent(params.runId.trim())}/replay`,
    method: 'POST',
    headers: (params) => buildTriggerDevHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        id: data.id,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'ID of the new run created by the replay' },
  },
}
