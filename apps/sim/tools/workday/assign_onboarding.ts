import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type {
  WorkdayAssignOnboardingParams,
  WorkdayAssignOnboardingResponse,
} from '@/tools/workday/types'
import { buildWorkdayBaseUrl, createWorkdayAuthHeader } from '@/tools/workday/utils'

const logger = createLogger('WorkdayAssignOnboardingTool')

export const assignOnboardingTool: ToolConfig<
  WorkdayAssignOnboardingParams,
  WorkdayAssignOnboardingResponse
> = {
  id: 'workday_assign_onboarding',
  name: 'Assign Workday Onboarding Plan',
  description:
    'Create or update an onboarding plan assignment for a worker. Sets up onboarding stages and manages the assignment lifecycle.',
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
      description: 'Worker ID to assign the onboarding plan to',
    },
    onboardingPlanId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Onboarding plan ID to assign',
    },
    stages: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON array of onboarding stage IDs to include (optional, defaults to all stages)',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = buildWorkdayBaseUrl(params.tenantUrl, params.tenant)
      return `${baseUrl}/workers/${params.workerId}/onboardingPlanAssignments`
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: createWorkdayAuthHeader(params.username, params.password),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        onboardingPlan: { id: params.onboardingPlanId },
      }

      if (params.stages) {
        try {
          const parsedStages =
            typeof params.stages === 'string' ? JSON.parse(params.stages) : params.stages
          body.stages = Array.isArray(parsedStages)
            ? parsedStages.map((s: string) => ({ id: s }))
            : []
        } catch {
          body.stages = []
        }
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    try {
      const data = await response.json()

      if (!response.ok) {
        const error = data.error ?? data.errors?.[0]?.error ?? data
        throw new Error(typeof error === 'string' ? error : JSON.stringify(error))
      }

      return {
        success: true,
        output: {
          assignmentId: data.id ?? null,
          workerId: data.worker?.id ?? null,
          planId: data.onboardingPlan?.id ?? null,
        },
      }
    } catch (error) {
      logger.error('Workday assign onboarding - Error processing response:', { error })
      throw error
    }
  },

  outputs: {
    assignmentId: {
      type: 'string',
      description: 'Onboarding plan assignment ID',
    },
    workerId: {
      type: 'string',
      description: 'Worker ID the plan was assigned to',
    },
    planId: {
      type: 'string',
      description: 'Onboarding plan ID that was assigned',
    },
  },
}
