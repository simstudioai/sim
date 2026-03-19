import type { ToolConfig } from '@/tools/types'
import type {
  WorkdayAssignOnboardingParams,
  WorkdayAssignOnboardingResponse,
} from '@/tools/workday/types'

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
    actionEventId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Action event ID that enables the onboarding plan (e.g., the hiring event ID)',
    },
  },

  request: {
    url: '/api/tools/workday/assign-onboarding',
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
