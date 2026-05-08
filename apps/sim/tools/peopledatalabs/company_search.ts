import type { PdlCompanySearchParams, PdlCompanySearchResponse } from '@/tools/peopledatalabs/types'
import { PDL_COMPANY_OUTPUT_PROPERTIES } from '@/tools/peopledatalabs/types'
import { projectCompany } from '@/tools/peopledatalabs/utils'
import type { ToolConfig } from '@/tools/types'

export const companySearchTool: ToolConfig<PdlCompanySearchParams, PdlCompanySearchResponse> = {
  id: 'pdl_company_search',
  name: 'PDL Company Search',
  description:
    'Search the People Data Labs company dataset using SQL or Elasticsearch DSL. Returns up to 100 matching companies per call.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'People Data Labs API key',
    },
    sql: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "PDL SQL query (e.g., \"SELECT * FROM company WHERE industry='computer software' AND size='51-200'\")",
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Elasticsearch DSL query as JSON string',
    },
    size: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to return (1-100, default 1)',
    },
    scroll_token: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token returned from a prior response',
    },
  },

  request: {
    url: () => 'https://api.peopledatalabs.com/v5/company/search',
    method: 'POST',
    headers: (params) => ({
      'X-Api-Key': params.apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.sql) body.sql = params.sql
      if (params.query) {
        try {
          body.query = JSON.parse(params.query)
        } catch {
          body.query = params.query
        }
      }
      if (params.size !== undefined) body.size = Number(params.size)
      if (params.scroll_token) body.scroll_token = params.scroll_token
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = (await response.json()) as Record<string, unknown>

    if (!response.ok) {
      const error = (data.error as { message?: string })?.message
      throw new Error(error || `People Data Labs error: ${response.status}`)
    }

    const records = (data.data as Record<string, unknown>[]) ?? []
    return {
      success: true,
      output: {
        total: (data.total as number) ?? records.length,
        scroll_token: (data.scroll_token as string) ?? null,
        results: records.map(projectCompany),
      },
    }
  },

  outputs: {
    total: { type: 'number', description: 'Total matching companies in dataset' },
    scroll_token: {
      type: 'string',
      description: 'Pagination token to fetch the next page; null if no more results',
      optional: true,
    },
    results: {
      type: 'array',
      description: 'Company records matching the query',
      items: { type: 'object', properties: PDL_COMPANY_OUTPUT_PROPERTIES },
    },
  },
}
