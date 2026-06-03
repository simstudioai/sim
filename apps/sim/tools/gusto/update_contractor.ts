import type {
  GustoContractorRecordResponse,
  GustoUpdateContractorParams,
} from '@/tools/gusto/types'
import { CONTRACTOR_OUTPUT_PROPERTIES } from '@/tools/gusto/types'
import { GUSTO_API_BASE, gustoErrorMessage, gustoHeaders } from '@/tools/gusto/utils'
import type { ToolConfig } from '@/tools/types'

export const gustoUpdateContractorTool: ToolConfig<
  GustoUpdateContractorParams,
  GustoContractorRecordResponse
> = {
  id: 'gusto_update_contractor',
  name: 'Gusto Update Contractor',
  description: 'Update an existing Gusto contractor',
  version: '1.0.0',

  oauth: { required: true, provider: 'gusto' },

  params: {
    contractorId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Gusto contractor UUID',
    },
    version: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Current version of the contractor record (required for updates)',
    },
    firstName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'First name',
    },
    lastName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Last name',
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
      description: 'Business name',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Contractor email',
    },
    startDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start date (YYYY-MM-DD)',
    },
    hourlyRate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Hourly rate',
    },
    wageType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Wage type (Fixed or Hourly)',
    },
    ein: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Employer Identification Number',
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
      `${GUSTO_API_BASE}/contractors/${encodeURIComponent(params.contractorId.trim())}`,
    method: 'PUT',
    headers: (params) => gustoHeaders(params.accessToken),
    body: (params) => {
      const body: Record<string, unknown> = { version: params.version }
      if (params.firstName) body.first_name = params.firstName
      if (params.lastName) body.last_name = params.lastName
      if (params.middleInitial) body.middle_initial = params.middleInitial
      if (params.businessName) body.business_name = params.businessName
      if (params.email) body.email = params.email
      if (params.startDate) body.start_date = params.startDate
      if (params.hourlyRate) body.hourly_rate = params.hourlyRate
      if (params.wageType) body.wage_type = params.wageType
      if (params.ein) body.ein = params.ein
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      return {
        success: false,
        error: gustoErrorMessage(data, 'Failed to update contractor'),
        output: {},
      }
    }
    return { success: true, output: { contractor: data } }
  },

  outputs: {
    contractor: {
      type: 'object',
      description: 'Updated contractor',
      properties: CONTRACTOR_OUTPUT_PROPERTIES,
    },
  },
}
