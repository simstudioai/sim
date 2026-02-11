import { buildIntercomUrl, handleIntercomError } from '@/tools/intercom/types'
import type { ToolConfig } from '@/tools/types'

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

const listCompaniesBase = {
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
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
    url: (params: IntercomListCompaniesParams) => {
      const url = buildIntercomUrl('/companies/list')
      const queryParams = new URLSearchParams()

      if (params.per_page) queryParams.append('per_page', params.per_page.toString())
      if (params.page) queryParams.append('page', params.page.toString())
      if (params.starting_after) queryParams.append('starting_after', params.starting_after)

      const queryString = queryParams.toString()
      return queryString ? `${url}?${queryString}` : url
    },
    method: 'POST',
    headers: (params: IntercomListCompaniesParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Intercom-Version': '2.14',
    }),
  },
} satisfies Pick<ToolConfig<IntercomListCompaniesParams, any>, 'params' | 'request'>

export const intercomListCompaniesTool: ToolConfig<
  IntercomListCompaniesParams,
  IntercomListCompaniesResponse
> = {
  id: 'intercom_list_companies',
  name: 'List Companies from Intercom',
  description:
    'List all companies from Intercom with pagination support. Note: This endpoint has a limit of 10,000 companies that can be returned using pagination. For datasets larger than 10,000 companies, use the Scroll API instead.',
  version: '1.0.0',

  ...listCompaniesBase,

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
    companies: {
      type: 'array',
      description: 'Array of company objects',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique identifier for the company' },
          type: { type: 'string', description: 'Object type (company)' },
          app_id: { type: 'string', description: 'Intercom app ID' },
          company_id: { type: 'string', description: 'Your unique identifier for the company' },
          name: { type: 'string', description: 'Name of the company' },
          website: { type: 'string', description: 'Company website URL' },
          plan: { type: 'object', description: 'Company plan information' },
          monthly_spend: { type: 'number', description: 'Monthly revenue from this company' },
          session_count: { type: 'number', description: 'Number of sessions' },
          user_count: { type: 'number', description: 'Number of users in the company' },
          created_at: { type: 'number', description: 'Unix timestamp when company was created' },
          updated_at: {
            type: 'number',
            description: 'Unix timestamp when company was last updated',
          },
          custom_attributes: {
            type: 'object',
            description: 'Custom attributes set on the company',
          },
          tags: { type: 'object', description: 'Tags associated with the company' },
          segments: { type: 'object', description: 'Segments the company belongs to' },
        },
      },
    },
    pages: {
      type: 'object',
      description: 'Pagination information',
      properties: {
        type: { type: 'string', description: 'Pages type identifier' },
        page: { type: 'number', description: 'Current page number' },
        per_page: { type: 'number', description: 'Number of results per page' },
        total_pages: { type: 'number', description: 'Total number of pages' },
      },
    },
    metadata: {
      type: 'object',
      description: 'Operation metadata',
      properties: {
        operation: { type: 'string', description: 'The operation performed (list_companies)' },
        total_count: { type: 'number', description: 'Total number of companies' },
      },
    },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}

interface IntercomListCompaniesV2Response {
  success: boolean
  output: {
    companies: any[]
    pages?: any
    total_count?: number
    success: boolean
  }
}

export const intercomListCompaniesV2Tool: ToolConfig<
  IntercomListCompaniesParams,
  IntercomListCompaniesV2Response
> = {
  ...listCompaniesBase,
  id: 'intercom_list_companies_v2',
  name: 'List Companies from Intercom',
  description:
    'List all companies from Intercom with pagination support. Note: This endpoint has a limit of 10,000 companies that can be returned using pagination. For datasets larger than 10,000 companies, use the Scroll API instead.',
  version: '2.0.0',

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
        total_count: data.total_count,
        success: true,
      },
    }
  },

  outputs: {
    companies: {
      type: 'array',
      description: 'Array of company objects',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique identifier for the company' },
          type: { type: 'string', description: 'Object type (company)' },
          app_id: { type: 'string', description: 'Intercom app ID' },
          company_id: { type: 'string', description: 'Your unique identifier for the company' },
          name: { type: 'string', description: 'Name of the company' },
          website: { type: 'string', description: 'Company website URL' },
          plan: { type: 'object', description: 'Company plan information' },
          monthly_spend: { type: 'number', description: 'Monthly revenue from this company' },
          session_count: { type: 'number', description: 'Number of sessions' },
          user_count: { type: 'number', description: 'Number of users in the company' },
          created_at: { type: 'number', description: 'Unix timestamp when company was created' },
          updated_at: {
            type: 'number',
            description: 'Unix timestamp when company was last updated',
          },
          custom_attributes: {
            type: 'object',
            description: 'Custom attributes set on the company',
          },
          tags: { type: 'object', description: 'Tags associated with the company' },
          segments: { type: 'object', description: 'Segments the company belongs to' },
        },
      },
    },
    pages: {
      type: 'object',
      description: 'Pagination information',
      properties: {
        type: { type: 'string', description: 'Pages type identifier' },
        page: { type: 'number', description: 'Current page number' },
        per_page: { type: 'number', description: 'Number of results per page' },
        total_pages: { type: 'number', description: 'Total number of pages' },
      },
    },
    total_count: { type: 'number', description: 'Total number of companies' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
