import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type {
  WorkdayGetCompensationParams,
  WorkdayGetCompensationResponse,
} from '@/tools/workday/types'
import { buildWorkdayBaseUrl, createWorkdayAuthHeader } from '@/tools/workday/utils'

const logger = createLogger('WorkdayGetCompensationTool')

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
    url: (params) => {
      const baseUrl = buildWorkdayBaseUrl(params.tenantUrl, params.tenant)
      return `${baseUrl}/workers/${params.workerId}/compensationPlans`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: createWorkdayAuthHeader(params.username, params.password),
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    try {
      const data = await response.json()

      if (!response.ok) {
        const error = data.error ?? data.errors?.[0]?.error ?? data
        throw new Error(typeof error === 'string' ? error : JSON.stringify(error))
      }

      const plans = Array.isArray(data.data) ? data.data : (data.compensationPlans ?? [])

      return {
        success: true,
        output: {
          compensationPlans: plans.map((p: Record<string, unknown>) => ({
            id: p.id ?? null,
            planName:
              (p.compensationPlan as Record<string, unknown>)?.descriptor ?? p.planName ?? null,
            amount: p.amount ?? p.compensationPlanAmount ?? null,
            currency: (p.currency as Record<string, unknown>)?.descriptor ?? p.currency ?? null,
            frequency: (p.frequency as Record<string, unknown>)?.descriptor ?? p.frequency ?? null,
          })),
        },
      }
    } catch (error) {
      logger.error('Workday get compensation - Error processing response:', { error })
      throw error
    }
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
