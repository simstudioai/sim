import type {
  TriggerDevListWaitpointTokensParams,
  TriggerDevListWaitpointTokensResponse,
} from '@/tools/trigger_dev/types'
import {
  buildTriggerDevHeaders,
  mapTriggerDevWaitpointToken,
  splitCommaSeparated,
  TRIGGER_DEV_API_BASE,
  TRIGGER_DEV_WAITPOINT_TOKEN_PROPERTIES,
} from '@/tools/trigger_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const triggerDevListWaitpointTokensTool: ToolConfig<
  TriggerDevListWaitpointTokensParams,
  TriggerDevListWaitpointTokensResponse
> = {
  id: 'trigger_dev_list_waitpoint_tokens',
  name: 'Trigger.dev List Waitpoint Tokens',
  description:
    'List Trigger.dev waitpoint tokens in the environment of the API key, with optional status, tag, and creation-time filters.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Trigger.dev secret API key (starts with tr_)',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Waitpoint status to filter by: WAITING, COMPLETED, or TIMED_OUT',
    },
    idempotencyKey: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Idempotency key to filter by',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated tags to filter by',
    },
    period: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return tokens created in the given period (e.g., "1h", "7d")',
    },
    from: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return tokens created on or after this ISO 8601 timestamp',
    },
    to: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return tokens created on or before this ISO 8601 timestamp',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of tokens per page (max 100)',
    },
    pageAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Waitpoint ID to start the page after, for forward pagination',
    },
    pageBefore: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Waitpoint ID to start the page before, for backward pagination',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.pageSize) query.set('page[size]', String(params.pageSize))
      if (params.pageAfter) query.set('page[after]', params.pageAfter)
      if (params.pageBefore) query.set('page[before]', params.pageBefore)
      if (params.status) query.set('filter[status]', params.status.toUpperCase())
      if (params.idempotencyKey) query.set('filter[idempotencyKey]', params.idempotencyKey)
      if (params.tags) {
        const tags = splitCommaSeparated(params.tags)
        if (tags.length > 0) query.set('filter[tags]', tags.join(','))
      }
      if (params.period) query.set('filter[createdAt][period]', params.period)
      if (params.from) query.set('filter[createdAt][from]', params.from)
      if (params.to) query.set('filter[createdAt][to]', params.to)
      const queryString = query.toString()
      return queryString
        ? `${TRIGGER_DEV_API_BASE}/api/v1/waitpoints/tokens?${queryString}`
        : `${TRIGGER_DEV_API_BASE}/api/v1/waitpoints/tokens`
    },
    method: 'GET',
    headers: (params) => buildTriggerDevHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        tokens: (data.data ?? []).map(mapTriggerDevWaitpointToken),
        pagination: {
          next: data.pagination?.next ?? null,
          previous: data.pagination?.previous ?? null,
        },
      },
    }
  },

  outputs: {
    tokens: {
      type: 'array',
      description: 'Waitpoint tokens matching the filters',
      items: {
        type: 'object',
        description: 'Waitpoint token',
        properties: TRIGGER_DEV_WAITPOINT_TOKEN_PROPERTIES,
      },
    },
    pagination: {
      type: 'object',
      description: 'Cursor pagination details',
      properties: {
        next: {
          type: 'string',
          description: 'Waitpoint ID to start the next page after',
          nullable: true,
        },
        previous: {
          type: 'string',
          description: 'Waitpoint ID to start the previous page before',
          nullable: true,
        },
      },
    },
  },
}
