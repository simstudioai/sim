import { companyenrichRequest, responseData } from '@/tools/companyenrich/request'
import type { CompanyEnrichParams, CompanyEnrichResponse } from '@/tools/companyenrich/types'
import type { ToolConfig } from '@/tools/types'

export const companyenrichCountTool: ToolConfig<CompanyEnrichParams, CompanyEnrichResponse> = {
  id: 'companyenrich_count',
  name: 'CompanyEnrich Count Companies',
  description:
    'Count Companies with CompanyEnrich. One request per execution; data requests can consume credits.',
  version: '1.1.0',
  errorExtractor: 'companyenrich-errors',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'CompanyEnrich API key without the Bearer prefix',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Literal company name/domain query, up to 250 characters.',
    },
    semanticQuery: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Natural-language company description, up to 500 characters.',
    },
    filters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Documented request-body filters, including nested fields. Explicit inputs take precedence; unknown fields are forwarded to the API.',
    },
  },
  request: companyenrichRequest('post_companies_search_count'),
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
