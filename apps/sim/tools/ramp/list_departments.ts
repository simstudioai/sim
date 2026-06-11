import type { RampListDepartmentsParams, RampListDepartmentsResponse } from '@/tools/ramp/types'
import {
  buildRampHeaders,
  buildRampUrl,
  extractNextStart,
  extractRampError,
} from '@/tools/ramp/utils'
import type { ToolConfig } from '@/tools/types'

export const rampListDepartmentsTool: ToolConfig<
  RampListDepartmentsParams,
  RampListDepartmentsResponse
> = {
  id: 'ramp_list_departments',
  name: 'Ramp List Departments',
  description: 'List departments in the Ramp business',
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
      buildRampUrl('/departments', {
        page_size: params.pageSize,
        start: params.start,
      }),
    method: 'GET',
    headers: (params) => buildRampHeaders(params),
  },

  transformResponse: async (response): Promise<RampListDepartmentsResponse> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: extractRampError(data, 'Failed to list Ramp departments'),
        output: {},
      }
    }

    return {
      success: true,
      output: {
        departments: data.data ?? [],
        nextStart: extractNextStart(data.page?.next),
      },
    }
  },

  outputs: {
    departments: {
      type: 'array',
      description: 'List of departments in the Ramp business',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique identifier for the department' },
          name: { type: 'string', description: 'Name of the department' },
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
