import type { CompanySimilarParams, CompanySimilarResponse } from '@/tools/companyenrich/types'
import { COMPANY_OUTPUT_PROPERTIES } from '@/tools/companyenrich/types'
import { pagination, parsePage, parseScores } from '@/tools/companyenrich/utils'
import type { ToolConfig } from '@/tools/types'

export const companyenrichSimilarTool: ToolConfig<CompanySimilarParams, CompanySimilarResponse> = {
  id: 'companyenrich_similar',
  name: 'CompanyEnrich Find Similar Companies',
  description:
    'Find lookalike companies from a seed domain. Costs 5 credits per result, with a 5-credit minimum per request.',
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
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'One-based page number (default 1)',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Companies per page, 1–100 (default 10). Each result consumes credits.',
    },
  },
  request: {
    url: () => 'https://api.companyenrich.com/companies/similar',
    method: 'POST',
    body: (params) => ({ domains: [params.domain], ...pagination(params) }),
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },
  transformResponse: async (response) => {
    if (!response.ok) throw new Error(`CompanyEnrich request failed (HTTP ${response.status})`)
    const data: unknown = await response.json()
    return { success: true, output: { ...parsePage(data), scores: parseScores(data) } }
  },
  outputs: {
    items: {
      type: 'array',
      description: 'Matching companies',
      items: { type: 'object', properties: COMPANY_OUTPUT_PROPERTIES },
    },
    page: { type: 'number', description: 'Current page number' },
    totalPages: { type: 'number', description: 'Total available pages' },
    totalItems: { type: 'number', description: 'Total matching companies' },
    scores: { type: 'json', description: 'Similarity scores keyed by company UUID, from 0 to 1' },
  },
}
