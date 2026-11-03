import { companyenrichRequest, responseData } from '@/tools/companyenrich/request'
import type { CompanyEnrichParams, CompanyEnrichResponse } from '@/tools/companyenrich/types'
import type { ToolConfig } from '@/tools/types'

export const companyenrichLookupPersonTool: ToolConfig<CompanyEnrichParams, CompanyEnrichResponse> =
  {
    id: 'companyenrich_lookup_person',
    name: 'CompanyEnrich Lookup Person',
    description:
      'Lookup Person with CompanyEnrich. One request per execution; data requests can consume credits.',
    version: '1.1.0',
    errorExtractor: 'companyenrich-errors',
    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'CompanyEnrich API key without the Bearer prefix',
      },
      email: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Email address to look up.',
      },
      expand: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Expansion array: ["workforce"] for companies (can spend extra credits) or ["education"] for people.',
      },
    },
    request: companyenrichRequest('post_people_lookup'),
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
