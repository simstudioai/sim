import type {
  GustoCompanyBenefitsListResponse,
  GustoListCompanyBenefitsParams,
} from '@/tools/gusto/types'
import { COMPANY_BENEFIT_OUTPUT_PROPERTIES } from '@/tools/gusto/types'
import { GUSTO_API_BASE, gustoErrorMessage, gustoHeaders } from '@/tools/gusto/utils'
import type { ToolConfig } from '@/tools/types'

export const gustoListCompanyBenefitsTool: ToolConfig<
  GustoListCompanyBenefitsParams,
  GustoCompanyBenefitsListResponse
> = {
  id: 'gusto_list_company_benefits',
  name: 'Gusto List Company Benefits',
  description: 'List all benefits configured for a Gusto company',
  version: '1.0.0',

  oauth: { required: true, provider: 'gusto' },

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
      `${GUSTO_API_BASE}/companies/${encodeURIComponent(params.companyId.trim())}/company_benefits`,
    method: 'GET',
    headers: (params) => gustoHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      return {
        success: false,
        error: gustoErrorMessage(data, 'Failed to list company benefits'),
        output: {},
      }
    }
    return {
      success: true,
      output: {
        companyBenefits: Array.isArray(data)
          ? data
          : (data.company_benefits ?? data.companyBenefits ?? []),
      },
    }
  },

  outputs: {
    companyBenefits: {
      type: 'array',
      description: 'Company benefits',
      items: { type: 'object', properties: COMPANY_BENEFIT_OUTPUT_PROPERTIES },
    },
  },
}
