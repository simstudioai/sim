import type { CompanySearchParams, CompanySearchResponse } from '@/tools/companyenrich/types'
import { COMPANY_OUTPUT_PROPERTIES } from '@/tools/companyenrich/types'
import { pagination, parsePage } from '@/tools/companyenrich/utils'
import type { ToolConfig } from '@/tools/types'

export const companyenrichSearchTool: ToolConfig<CompanySearchParams, CompanySearchResponse> = {
  id: 'companyenrich_search',
  name: 'CompanyEnrich Search Companies',
  description:
    'Search company names and domains. Costs 1 credit per result, with a 1-credit minimum per request.',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'CompanyEnrich API key without the Bearer prefix',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Search query applied to company names and domains',
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
    url: () => 'https://api.companyenrich.com/companies/search',
    method: 'POST',
    body: (params) => ({ query: params.query, ...pagination(params) }),
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },
  transformResponse: async (response) => {
    if (!response.ok) throw new Error(`CompanyEnrich request failed (HTTP ${response.status})`)
    const data: unknown = await response.json()
    return { success: true, output: { ...parsePage(data) } }
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
  },
}
