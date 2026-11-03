import { companyenrichRequest, responseData } from '@/tools/companyenrich/request'
import type { CompanyEnrichParams, CompanyEnrichResponse } from '@/tools/companyenrich/types'
import type { ToolConfig } from '@/tools/types'

export const companyenrichAdvancedTool: ToolConfig<CompanyEnrichParams, CompanyEnrichResponse> = {
  id: 'companyenrich_advanced',
  name: 'CompanyEnrich Advanced Request',
  description:
    'Execute one of 42 allowlisted CompanyEnrich data, lookup or job operations. No retries, pagination, polling or result downloads. Email beta requires explicit opt-in; saved-list administration and account responses are excluded.',
  version: '1.1.0',
  errorExtractor: 'companyenrich-errors',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'CompanyEnrich API key without the Bearer prefix',
    },
    apiOperation: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Documented operation ID from the advanced selector; exactly one request, without polling or downloads.',
    },
    body: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Full documented JSON body; export count must be explicit and at most 50,000.',
    },
    queryParameters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Documented query parameters as an object.',
    },
    pathParameters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Documented path parameters such as jobId or countryCode.',
    },
    allow_beta: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Explicitly allow beta email operations and their credit costs (default false).',
    },
  },
  request: companyenrichRequest('advanced'),
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
