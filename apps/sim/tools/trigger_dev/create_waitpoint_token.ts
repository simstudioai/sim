import type {
  TriggerDevCreateWaitpointTokenParams,
  TriggerDevCreateWaitpointTokenResponse,
} from '@/tools/trigger_dev/types'
import {
  buildTriggerDevHeaders,
  splitCommaSeparated,
  TRIGGER_DEV_API_BASE,
} from '@/tools/trigger_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const triggerDevCreateWaitpointTokenTool: ToolConfig<
  TriggerDevCreateWaitpointTokenParams,
  TriggerDevCreateWaitpointTokenResponse
> = {
  id: 'trigger_dev_create_waitpoint_token',
  name: 'Trigger.dev Create Waitpoint Token',
  description:
    'Create a Trigger.dev waitpoint token that a task can wait on until it is completed from outside (e.g., a human approval).',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Trigger.dev secret API key (starts with tr_)',
    },
    timeout: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'How long before the token times out, as a duration ("30s", "1m", "2h", "3d") or an ISO 8601 date',
    },
    idempotencyKey: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Idempotency key; passing the same key before it expires returns the original token',
    },
    idempotencyKeyTTL: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'How long the idempotency key is valid, as a duration ("30s", "1m", "2h", "3d")',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated tags to attach to the waitpoint (max 10, each under 128 characters)',
    },
  },

  request: {
    url: `${TRIGGER_DEV_API_BASE}/api/v1/waitpoints/tokens`,
    method: 'POST',
    headers: (params) => buildTriggerDevHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.timeout) body.timeout = params.timeout
      if (params.idempotencyKey) body.idempotencyKey = params.idempotencyKey
      if (params.idempotencyKeyTTL) body.idempotencyKeyTTL = params.idempotencyKeyTTL
      if (params.tags) {
        const tags = splitCommaSeparated(params.tags)
        if (tags.length > 0) body.tags = tags
      }
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        id: data.id,
        isCached: data.isCached ?? false,
        url: data.url,
      },
    }
  },

  outputs: {
    id: {
      type: 'string',
      description: 'Unique ID of the waitpoint token (starts with waitpoint_)',
    },
    isCached: {
      type: 'boolean',
      description:
        'Whether an existing token was returned because the same idempotency key was reused',
    },
    url: {
      type: 'string',
      description:
        'HTTP callback URL; a POST request to this URL completes the waitpoint without an API key',
    },
  },
}
