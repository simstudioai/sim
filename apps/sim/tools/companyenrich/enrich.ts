import type { CompanyEnrichParams, CompanyEnrichResponse } from '@/tools/companyenrich/types'
import { COMPANY_OUTPUT_PROPERTIES } from '@/tools/companyenrich/types'
import { parseCompany } from '@/tools/companyenrich/utils'
import type { ToolConfig } from '@/tools/types'

export const companyenrichEnrichTool: ToolConfig<CompanyEnrichParams, CompanyEnrichResponse> = {
  id: 'companyenrich_enrich',
  name: 'CompanyEnrich Enrich Company',
  description: 'Enrich one company by domain. Costs 1 CompanyEnrich credit per call.',
  version: '1.0.0',
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
      description: 'Company domain, for example example.com',
    },
  },
  request: {
    url: (params) =>
      `https://api.companyenrich.com/companies/enrich?${new URLSearchParams({ domain: params.domain })}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },
  transformResponse: async (response) => {
    if (!response.ok) throw new Error(`CompanyEnrich request failed (HTTP ${response.status})`)
    const data: unknown = await response.json()
    return { success: true, output: { company: parseCompany(data) } }
  },
  outputs: {
    company: {
      type: 'object',
      description: 'Enriched company profile',
      properties: COMPANY_OUTPUT_PROPERTIES,
    },
  },
}
