import type {
  GustoContractorRecordResponse,
  GustoCreateContractorParams,
} from '@/tools/gusto/types'
import { CONTRACTOR_OUTPUT_PROPERTIES } from '@/tools/gusto/types'
import { GUSTO_API_BASE, gustoErrorMessage, gustoHeaders } from '@/tools/gusto/utils'
import type { ToolConfig } from '@/tools/types'

export const gustoCreateContractorTool: ToolConfig<
  GustoCreateContractorParams,
  GustoContractorRecordResponse
> = {
  id: 'gusto_create_contractor',
  name: 'Gusto Create Contractor',
  description: 'Create a new contractor in a Gusto company',
  version: '1.0.0',

  oauth: { required: true, provider: 'gusto' },

  params: {
    companyId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Gusto company UUID',
    },
    type: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Contractor type (Individual or Business)',
    },
    wageType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Wage type (Fixed or Hourly)',
    },
    startDate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Contractor start date (YYYY-MM-DD)',
    },
    firstName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'First name (required for Individual contractors)',
    },
    lastName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Last name (required for Individual contractors)',
    },
    middleInitial: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Middle initial',
    },
    businessName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Business name (required for Business contractors)',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Contractor email',
    },
    selfOnboarding: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Send self-onboarding invite to the contractor',
    },
    ein: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Employer Identification Number (Business contractors)',
    },
    hourlyRate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Hourly rate (when wage type is Hourly)',
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
      `${GUSTO_API_BASE}/companies/${encodeURIComponent(params.companyId.trim())}/contractors`,
    method: 'POST',
    headers: (params) => gustoHeaders(params.accessToken),
    body: (params) => {
      const body: Record<string, unknown> = {
        type: params.type,
        wage_type: params.wageType,
        start_date: params.startDate,
      }
      if (params.firstName) body.first_name = params.firstName
      if (params.lastName) body.last_name = params.lastName
      if (params.middleInitial) body.middle_initial = params.middleInitial
      if (params.businessName) body.business_name = params.businessName
      if (params.email) body.email = params.email
      if (params.selfOnboarding !== undefined) body.self_onboarding = params.selfOnboarding
      if (params.ein) body.ein = params.ein
      if (params.hourlyRate) body.hourly_rate = params.hourlyRate
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      return {
        success: false,
        error: gustoErrorMessage(data, 'Failed to create contractor'),
        output: {},
      }
    }
    return { success: true, output: { contractor: data } }
  },

  outputs: {
    contractor: {
      type: 'object',
      description: 'Created contractor',
      properties: CONTRACTOR_OUTPUT_PROPERTIES,
    },
  },
}
