import type { RampListSpendProgramsParams, RampListSpendProgramsResponse } from '@/tools/ramp/types'
import {
  buildRampHeaders,
  buildRampUrl,
  extractNextStart,
  extractRampError,
} from '@/tools/ramp/utils'
import type { ToolConfig } from '@/tools/types'

export const rampListSpendProgramsTool: ToolConfig<
  RampListSpendProgramsParams,
  RampListSpendProgramsResponse
> = {
  id: 'ramp_list_spend_programs',
  name: 'Ramp List Spend Programs',
  description: 'List spend programs in the Ramp business',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'ramp',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for the Ramp API',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page (between 2 and 100, default 20)',
    },
    start: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor: the ID of the last entity from the previous page',
    },
  },

  request: {
    url: (params) =>
      buildRampUrl('/spend-programs', {
        page_size: params.pageSize,
        start: params.start,
      }),
    method: 'GET',
    headers: (params) => buildRampHeaders(params),
  },

  transformResponse: async (response): Promise<RampListSpendProgramsResponse> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: extractRampError(data, 'Failed to list Ramp spend programs'),
        output: {},
      }
    }

    return {
      success: true,
      output: {
        spendPrograms: data.data ?? [],
        nextStart: extractNextStart(data.page?.next),
      },
    }
  },

  outputs: {
    spendPrograms: {
      type: 'array',
      description: 'List of spend programs in the Ramp business',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique identifier for the spend program' },
          display_name: { type: 'string', description: 'Display name of the spend program' },
          description: { type: 'string', description: 'Description of the spend program' },
          is_shareable: {
            type: 'boolean',
            description: 'Whether limits under this program can be shared',
          },
          permitted_spend_types: {
            type: 'object',
            description: 'Spend types permitted by the program (card and/or reimbursement)',
          },
          restrictions: { type: 'object', description: 'Spending restrictions of the program' },
        },
      },
    },
    nextStart: {
      type: 'string',
      description: 'Cursor for the next page of results (null when there are no more pages)',
      optional: true,
    },
  },
}
