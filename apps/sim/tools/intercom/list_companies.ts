import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildIntercomUrl, handleIntercomError } from './types'

const logger = createLogger('IntercomListCompanies')

export interface IntercomListCompaniesParams {
  accessToken: string
  per_page?: number
  page?: number
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
  description: 'List all companies from Intercom with pagination support',
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
      visibility: 'user-only',
      description: 'Number of results per page',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Page number',
    },
  },

  request: {
    url: (params) => {
      const url = buildIntercomUrl('/companies/list')
      const queryParams = new URLSearchParams()

      if (params.per_page) queryParams.append('per_page', params.per_page.toString())
      if (params.page) queryParams.append('page', params.page.toString())

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
