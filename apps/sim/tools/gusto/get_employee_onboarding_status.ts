import type {
  GustoGetEmployeeOnboardingStatusParams,
  GustoOnboardingStatusResponse,
} from '@/tools/gusto/types'
import { ONBOARDING_STATUS_OUTPUT_PROPERTIES } from '@/tools/gusto/types'
import { GUSTO_API_BASE, gustoErrorMessage, gustoHeaders } from '@/tools/gusto/utils'
import type { ToolConfig } from '@/tools/types'

export const gustoGetEmployeeOnboardingStatusTool: ToolConfig<
  GustoGetEmployeeOnboardingStatusParams,
  GustoOnboardingStatusResponse
> = {
  id: 'gusto_get_employee_onboarding_status',
  name: 'Gusto Get Employee Onboarding Status',
  description: 'Get the onboarding status for a Gusto employee',
  version: '1.0.0',

  oauth: { required: true, provider: 'gusto' },

  params: {
    employeeId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Gusto employee UUID',
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
      `${GUSTO_API_BASE}/employees/${encodeURIComponent(
        params.employeeId.trim()
      )}/onboarding_status`,
    method: 'GET',
    headers: (params) => gustoHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      return {
        success: false,
        error: gustoErrorMessage(data, 'Failed to get onboarding status'),
        output: {},
      }
    }
    return { success: true, output: { onboardingStatus: data } }
  },

  outputs: {
    onboardingStatus: {
      type: 'object',
      description: 'Employee onboarding status',
      properties: ONBOARDING_STATUS_OUTPUT_PROPERTIES,
    },
  },
}
