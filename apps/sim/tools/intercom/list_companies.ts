import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildIntercomUrl, handleIntercomError } from './types'

const logger = createLogger('IntercomListCompanies')

export interface IntercomListCompaniesParams {
  accessToken: string
  per_page?: number
  page?: number
  starting_after?: string
}

export interface IntercomListCompaniesResponse {
  success: boolean
  output: {
    companies: any[]
    pages?: any
    metadata: {
      operation: 'list_companies'
      total_count?: number
    }
    success: boolean
  }
}

export const intercomListCompaniesTool: ToolConfig<
  IntercomListCompaniesParams,
  IntercomListCompaniesResponse
> = {
  id: 'intercom_list_companies',
  name: 'List Companies from Intercom',
  description:
    'List all companies from Intercom with pagination support. Note: This endpoint has a limit of 10,000 companies that can be returned using pagination. For datasets larger than 10,000 companies, use the Scroll API instead.',
  version: '1.0.0',

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Intercom API access token',
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number',
    },
    starting_after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor for pagination (preferred over page-based pagination)',
    },
  },

  request: {
    url: (params) => {
      const url = buildIntercomUrl('/companies/list')
      const queryParams = new URLSearchParams()

      if (params.per_page) queryParams.append('per_page', params.per_page.toString())
      if (params.page) queryParams.append('page', params.page.toString())
      if (params.starting_after) queryParams.append('starting_after', params.starting_after)

      const queryString = queryParams.toString()
      return queryString ? `${url}?${queryString}` : url
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Intercom-Version': '2.14',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleIntercomError(data, response.status, 'list_companies')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        companies: data.data || data.companies || [],
        pages: data.pages,
        metadata: {
          operation: 'list_companies' as const,
          total_count: data.total_count,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'List of companies',
      properties: {
        companies: { type: 'array', description: 'Array of company objects' },
        pages: { type: 'object', description: 'Pagination information' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
