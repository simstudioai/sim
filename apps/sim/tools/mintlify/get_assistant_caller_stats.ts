import type {
  MintlifyGetAssistantCallerStatsParams,
  MintlifyGetAssistantCallerStatsResponse,
} from '@/tools/mintlify/types'
import {
  appendParam,
  MINTLIFY_API_BASE,
  mintlifyHeaders,
  pathSegment,
  readMintlifyJson,
  toNullableNumber,
} from '@/tools/mintlify/utils'
import type { ToolConfig } from '@/tools/types'

export const mintlifyGetAssistantCallerStatsTool: ToolConfig<
  MintlifyGetAssistantCallerStatsParams,
  MintlifyGetAssistantCallerStatsResponse
> = {
  id: 'mintlify_get_assistant_caller_stats',
  name: 'Mintlify Get Assistant Caller Stats',
  description:
    'Get a breakdown of Mintlify assistant query counts by caller type — web, API, and other — for a date range.',
  version: '1.0.0',

  params: {
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Mintlify project ID, copied from the API keys page in your dashboard',
    },
    dateFrom: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Inclusive start date in ISO 8601 or YYYY-MM-DD format',
    },
    dateTo: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exclusive end date in ISO 8601 or YYYY-MM-DD format',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Mintlify admin API key (starts with mint_)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `${MINTLIFY_API_BASE}/v1/analytics/${pathSegment(params.projectId)}/assistant/caller-stats`
      )
      appendParam(url, 'dateFrom', params.dateFrom)
      appendParam(url, 'dateTo', params.dateTo)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => mintlifyHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await readMintlifyJson(response, 'Failed to get Mintlify assistant caller stats')

    return {
      success: true,
      output: {
        web: toNullableNumber(data.web),
        api: toNullableNumber(data.api),
        other: toNullableNumber(data.other),
        total: toNullableNumber(data.total),
      },
    }
  },

  outputs: {
    web: {
      type: 'number',
      description: 'Assistant queries originating from the documentation site',
      nullable: true,
    },
    api: {
      type: 'number',
      description: 'Assistant queries originating from API calls',
      nullable: true,
    },
    other: {
      type: 'number',
      description: 'Assistant queries from other sources such as integrations and SDKs',
      nullable: true,
    },
    total: {
      type: 'number',
      description: 'Total assistant queries across all caller types',
      nullable: true,
    },
  },
}
