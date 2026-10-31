import { companyenrichRequest, responseData } from '@/tools/companyenrich/request'
import type { CompanyEnrichParams, CompanyEnrichResponse } from '@/tools/companyenrich/types'
import { COMPANY_OUTPUT_PROPERTIES } from '@/tools/companyenrich/types'
import { parseCompany } from '@/tools/companyenrich/utils'
import type { ToolConfig } from '@/tools/types'

export const companyenrichEnrichTool: ToolConfig<CompanyEnrichParams, CompanyEnrichResponse> = {
  id: 'companyenrich_enrich',
  name: 'CompanyEnrich Enrich Company',
  description:
    'Enrich Company with CompanyEnrich. One request per execution; data requests can consume credits.',
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
      required: true,
      visibility: 'user-or-llm',
      description:
        'Company domain. For lookalikes, domains takes precedence over this legacy single seed.',
    },
    expand: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Expansion array: ["workforce"] for companies (can spend extra credits) or ["education"] for people.',
    },
    waitForEnrichment: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Wait for enrichment on supported company endpoints.',
    },
  },
  request: companyenrichRequest('get_companies_enrich'),
  transformResponse: async (response) => {
    const data = await responseData(response)
    return { success: true, output: { company: parseCompany(data), data } }
  },
  outputs: {
    company: {
      type: 'object',
      description: 'Company profile, including all provider fields.',
      properties: COMPANY_OUTPUT_PROPERTIES,
    },
    data: {
      type: 'json',
      description: 'Complete unmodified company profile, preserving nulls and future fields.',
    },
  },
}
