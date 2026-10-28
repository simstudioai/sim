import { toArray } from '@sim/utils/object'
import {
  bufferOutputProperties,
  bufferSelection,
  parseBufferInput,
  projectBufferObject,
} from '@/tools/buffer/schema'
import {
  BUFFER_API_URL,
  type BufferDailyLimitsParams,
  type BufferDailyLimitsResponse,
  bufferHeaders,
  bufferStringList,
  parseBufferGraphQLResponse,
} from '@/tools/buffer/types'
import type { ToolConfig } from '@/tools/types'

export const bufferGetDailyPostingLimitsTool: ToolConfig<
  BufferDailyLimitsParams,
  BufferDailyLimitsResponse
> = {
  id: 'buffer_get_daily_posting_limits',
  name: 'Buffer Get Daily Posting Limits',
  description: 'Check sent and scheduled post counts against each channel’s daily limit for a date',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Buffer API key with posts:read permission',
    },
    channelIds: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Channel ID array or comma-separated IDs; all channels must belong to the same organization',
    },
    date: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO 8601 timestamp for the date to check; omit for today',
    },
  },
  request: {
    url: BUFFER_API_URL,
    method: 'POST',
    headers: (params) => bufferHeaders(params.apiKey),
    body: (params) => ({
      query: `query DailyPostingLimits($input: DailyPostingLimitsInput!) { dailyPostingLimits(input: $input) { ${bufferSelection('DailyPostingLimitStatus')} } }`,
      variables: {
        input: parseBufferInput('DailyPostingLimitsInput', {
          channelIds: bufferStringList(params.channelIds),
          ...(params.date ? { date: params.date } : {}),
        }),
      },
    }),
  },
  transformResponse: async (response) => {
    const data = await parseBufferGraphQLResponse(response)
    return {
      success: true,
      output: {
        limits: toArray(data.dailyPostingLimits).map((value) =>
          projectBufferObject('DailyPostingLimitStatus', value)
        ),
      },
    }
  },
  outputs: {
    limits: {
      type: 'array',
      description: 'Daily limit status per channel',
      items: { type: 'object', properties: bufferOutputProperties('DailyPostingLimitStatus') },
    },
  },
}
