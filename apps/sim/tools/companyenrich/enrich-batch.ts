import { companyenrichRequest, responseData } from '@/tools/companyenrich/request'
import type { CompanyEnrichParams, CompanyEnrichResponse } from '@/tools/companyenrich/types'
import type { ToolConfig } from '@/tools/types'

export const companyenrichEnrichBatchTool: ToolConfig<CompanyEnrichParams, CompanyEnrichResponse> =
  {
    id: 'companyenrich_enrich_batch',
    name: 'CompanyEnrich Batch Enrich Companies',
    description:
      'Batch Enrich Companies with CompanyEnrich. One request per execution; data requests can consume credits.',
    version: '1.1.0',
    errorExtractor: 'companyenrich-errors',
    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'CompanyEnrich API key without the Bearer prefix',
      },
      domains: {
        type: 'json',
        required: true,
        visibility: 'user-or-llm',
        description:
          'Array of 1\u201310 seed domains for lookalikes or 1\u201350 domains for batch enrichment.',
      },
      expand: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Expansion array: ["workforce"] for companies (can spend extra credits) or ["education"] for people.',
      },
    },
    request: companyenrichRequest('post_companies_enrich_batch'),
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
