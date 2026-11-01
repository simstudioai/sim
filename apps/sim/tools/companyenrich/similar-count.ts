import { companyenrichRequest, responseData } from '@/tools/companyenrich/request'
import type { CompanyEnrichParams, CompanyEnrichResponse } from '@/tools/companyenrich/types'
import type { ToolConfig } from '@/tools/types'

export const companyenrichSimilarCountTool: ToolConfig<CompanyEnrichParams, CompanyEnrichResponse> =
  {
    id: 'companyenrich_similar_count',
    name: 'CompanyEnrich Count Similar Companies',
    description:
      'Count Similar Companies with CompanyEnrich. One request per execution; data requests can consume credits.',
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
      domains: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Array of 1\u201310 seed domains for lookalikes or 1\u201350 domains for batch enrichment.',
      },
      filters: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Documented request-body filters, including nested fields. Explicit inputs take precedence; unknown fields are forwarded to the API.',
      },
      waitForEnrichment: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Wait for enrichment on supported company endpoints.',
      },
    },
    request: companyenrichRequest('post_companies_similar_count'),
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
