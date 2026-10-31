import { companyenrichRequest, responseData } from '@/tools/companyenrich/request'
import type { CompanyEnrichParams, CompanyEnrichResponse } from '@/tools/companyenrich/types'
import type { ToolConfig } from '@/tools/types'

export const companyenrichGetCompanyTool: ToolConfig<CompanyEnrichParams, CompanyEnrichResponse> = {
  id: 'companyenrich_get_company',
  name: 'CompanyEnrich Get Company',
  description:
    'Get Company with CompanyEnrich. One request per execution; data requests can consume credits.',
  version: '1.1.0',
  errorExtractor: 'companyenrich-errors',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'CompanyEnrich API key without the Bearer prefix',
    },
    id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Company UUID or positive person ID; use a decimal string for person IDs to avoid precision loss.',
    },
    expand: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Expansion array: ["workforce"] for companies (can spend extra credits) or ["education"] for people.',
    },
  },
  request: companyenrichRequest('get_companies'),
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
