import { companyenrichRequest, responseData } from '@/tools/companyenrich/request'
import type { CompanyEnrichParams, CompanyEnrichResponse } from '@/tools/companyenrich/types'
import type { ToolConfig } from '@/tools/types'

export const companyenrichWorkforceTool: ToolConfig<CompanyEnrichParams, CompanyEnrichResponse> = {
  id: 'companyenrich_workforce',
  name: 'CompanyEnrich Get Company Workforce',
  description:
    'Get Company Workforce with CompanyEnrich. One request per execution; data requests can consume credits.',
  version: '1.1.0',
  errorExtractor: 'companyenrich-errors',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'CompanyEnrich API key without the Bearer prefix',
    },
    domain: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Company domain. For lookalikes, domains takes precedence over this legacy single seed.',
    },
    id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Company UUID or positive person ID; use a decimal string for person IDs to avoid precision loss.',
    },
  },
  request: companyenrichRequest('get_companies_workforce'),
  transformResponse: async (response) => {
    const data = await responseData(response)
    return { success: true, output: { data } }
  },
  outputs: {
    data: {
      type: 'json',
      description:
        'Complete API response; an object, array or count according to the selected operation.',
    },
  },
}
