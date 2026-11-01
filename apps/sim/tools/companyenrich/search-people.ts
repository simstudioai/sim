import { companyenrichRequest, responseData } from '@/tools/companyenrich/request'
import type { CompanyEnrichParams, CompanyEnrichResponse } from '@/tools/companyenrich/types'
import type { ToolConfig } from '@/tools/types'

export const companyenrichSearchPeopleTool: ToolConfig<CompanyEnrichParams, CompanyEnrichResponse> =
  {
    id: 'companyenrich_search_people',
    name: 'CompanyEnrich Search People',
    description:
      'Search People with CompanyEnrich. One request per execution; data requests can consume credits.',
    version: '1.1.0',
    errorExtractor: 'companyenrich-errors',
    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'CompanyEnrich API key without the Bearer prefix',
      },
      filters: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Documented request-body filters, including nested fields. Explicit inputs take precedence; unknown fields are forwarded to the API.',
      },
      page: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'One-based page number (default 1). One page per execution.',
      },
      pageSize: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Results per page, 1\u2013100 (default 10). Additional pages can consume credits.',
      },
      expand: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Expansion array: ["workforce"] for companies (can spend extra credits) or ["education"] for people.',
      },
    },
    request: companyenrichRequest('post_people_search'),
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
