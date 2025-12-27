import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildZendeskUrl, handleZendeskError } from './types'

const logger = createLogger('ZendeskGetOrganizations')

export interface ZendeskGetOrganizationsParams {
  email: string
  apiToken: string
  subdomain: string
  perPage?: string
  page?: string
}

export interface ZendeskGetOrganizationsResponse {
  success: boolean
  output: {
    organizations: any[]
    paging?: {
      nextPage?: string | null
      previousPage?: string | null
      count: number
    }
    metadata: {
      operation: 'get_organizations'
      totalReturned: number
    }
    success: boolean
  }
}

export const zendeskGetOrganizationsTool: ToolConfig<
  ZendeskGetOrganizationsParams,
  ZendeskGetOrganizationsResponse
> = {
  id: 'zendesk_get_organizations',
  name: 'Get Organizations from Zendesk',
  description: 'Retrieve a list of organizations from Zendesk',
  version: '1.0.0',

  params: {
    email: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Zendesk email address',
    },
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Zendesk API token',
    },
    subdomain: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Zendesk subdomain (e.g., "mycompany" for mycompany.zendesk.com)',
    },
    perPage: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Results per page (default: 100, max: 100)',
    },
    page: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Page number',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.page) queryParams.append('page', params.page)
      if (params.perPage) queryParams.append('per_page', params.perPage)

      const query = queryParams.toString()
      const url = buildZendeskUrl(params.subdomain, '/organizations')
      return query ? `${url}?${query}` : url
    },
    method: 'GET',
    headers: (params) => {
      const credentials = `${params.email}/token:${params.apiToken}`
      const base64Credentials = Buffer.from(credentials).toString('base64')
      return {
        Authorization: `Basic ${base64Credentials}`,
        'Content-Type': 'application/json',
      }
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleZendeskError(data, response.status, 'get_organizations')
    }

    const data = await response.json()
    const organizations = data.organizations || []

    return {
      success: true,
      output: {
        organizations,
        paging: {
          nextPage: data.next_page,
          previousPage: data.previous_page,
          count: data.count || organizations.length,
        },
        metadata: {
          operation: 'get_organizations' as const,
          totalReturned: organizations.length,
        },
        success: true,
      },
    }
  },

  outputs: {
    organizations: { type: 'array', description: 'Array of organization objects' },
    paging: { type: 'object', description: 'Pagination information' },
    metadata: { type: 'object', description: 'Operation metadata' },
  },
}
