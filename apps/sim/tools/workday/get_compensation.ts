import type { ToolConfig } from '@/tools/types'
import type {
  WorkdayGetCompensationParams,
  WorkdayGetCompensationResponse,
} from '@/tools/workday/types'

export const getCompensationTool: ToolConfig<
  WorkdayGetCompensationParams,
  WorkdayGetCompensationResponse
> = {
  id: 'workday_get_compensation',
  name: 'Get Workday Compensation',
  description: 'Retrieve compensation plan details for a specific worker.',
  version: '1.0.0',

  params: {
    tenantUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Workday instance URL (e.g., https://wd5-impl-services1.workday.com)',
    },
    tenant: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Workday tenant name',
    },
    username: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Integration System User username',
    },
    password: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Integration System User password',
    },
    workerId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Worker ID to retrieve compensation data for',
    },
  },

  request: {
    url: '/api/tools/workday/get-compensation',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => params,
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error ?? 'Workday API request failed')
    }
    return data
  },

  outputs: {
    compensationPlans: {
      type: 'array',
      description: 'Array of compensation plan details',
      items: {
        type: 'json',
        description: 'Compensation plan with amount, currency, and frequency',
        properties: {
          id: { type: 'string', description: 'Compensation plan ID' },
          planName: { type: 'string', description: 'Name of the compensation plan' },
          amount: { type: 'number', description: 'Compensation amount' },
          currency: { type: 'string', description: 'Currency code' },
          frequency: { type: 'string', description: 'Pay frequency' },
        },
      },
    },
  },
}
