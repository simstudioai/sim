import type {
  GustoListPaySchedulesParams,
  GustoListPaySchedulesResponse,
} from '@/tools/gusto/types'
import { PAY_SCHEDULE_OUTPUT_PROPERTIES } from '@/tools/gusto/types'
import { GUSTO_API_BASE, gustoErrorMessage, gustoHeaders } from '@/tools/gusto/utils'
import type { ToolConfig } from '@/tools/types'

export const gustoListPaySchedulesTool: ToolConfig<
  GustoListPaySchedulesParams,
  GustoListPaySchedulesResponse
> = {
  id: 'gusto_list_pay_schedules',
  name: 'Gusto List Pay Schedules',
  description: 'List pay schedules for a Gusto company',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'gusto',
  },

  params: {
    companyId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Gusto company UUID',
    },
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token',
    },
  },

  request: {
    url: (params) =>
      `${GUSTO_API_BASE}/companies/${encodeURIComponent(params.companyId.trim())}/pay_schedules`,
    method: 'GET',
    headers: (params) => gustoHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      return {
        success: false,
        error: gustoErrorMessage(data, 'Failed to list pay schedules'),
        output: {},
      }
    }
    return {
      success: true,
      output: { paySchedules: Array.isArray(data) ? data : (data.pay_schedules ?? []) },
    }
  },

  outputs: {
    paySchedules: {
      type: 'array',
      description: 'List of pay schedules',
      items: {
        type: 'object',
        properties: PAY_SCHEDULE_OUTPUT_PROPERTIES,
      },
    },
  },
}
