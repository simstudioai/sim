import type {
  TriggerDevAddRunTagsParams,
  TriggerDevAddRunTagsResponse,
} from '@/tools/trigger_dev/types'
import {
  buildTriggerDevHeaders,
  splitCommaSeparated,
  TRIGGER_DEV_API_BASE,
} from '@/tools/trigger_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const triggerDevAddRunTagsTool: ToolConfig<
  TriggerDevAddRunTagsParams,
  TriggerDevAddRunTagsResponse
> = {
  id: 'trigger_dev_add_run_tags',
  name: 'Trigger.dev Add Run Tags',
  description: 'Add tags to an existing Trigger.dev run. Runs can have up to 10 tags.',
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
      description: 'ID of the run to tag (starts with run_)',
    },
    tags: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Comma-separated tags to add to the run (max 10 total, each under 128 characters)',
    },
  },

  request: {
    url: (params) =>
      `${TRIGGER_DEV_API_BASE}/api/v1/runs/${encodeURIComponent(params.runId.trim())}/tags`,
    method: 'POST',
    headers: (params) => buildTriggerDevHeaders(params.apiKey),
    body: (params) => ({ tags: splitCommaSeparated(params.tags) }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        message: data.message ?? '',
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Confirmation message for the added tags' },
  },
}
