import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildZendeskUrl, handleZendeskError } from './types'

const logger = createLogger('ZendeskAutocompleteOrganizations')

export interface ZendeskAutocompleteOrganizationsParams {
  email: string
  apiToken: string
  subdomain: string
  name: string
  perPage?: string
  page?: string
}

export interface ZendeskAutocompleteOrganizationsResponse {
  success: boolean
  output: {
    organizations: any[]
    paging?: {
      next_page?: string | null
      previous_page?: string | null
      count: number
    }
    metadata: {
      total_returned: number
      has_more: boolean
    }
    success: boolean
  }
}

export const zendeskAutocompleteOrganizationsTool: ToolConfig<
  ZendeskAutocompleteOrganizationsParams,
  ZendeskAutocompleteOrganizationsResponse
> = {
  id: 'zendesk_autocomplete_organizations',
  name: 'Autocomplete Organizations in Zendesk',
  description:
    'Autocomplete organizations in Zendesk by name prefix (for name matching/autocomplete)',
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
      description: 'Your Zendesk subdomain',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Organization name to search for',
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
      queryParams.append('name', params.name)
      if (params.page) queryParams.append('page', params.page)
      if (params.perPage) queryParams.append('per_page', params.perPage)

      const query = queryParams.toString()
      const url = buildZendeskUrl(params.subdomain, '/organizations/autocomplete')
      return `${url}?${query}`
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
      handleZendeskError(data, response.status, 'autocomplete_organizations')
    }

    const data = await response.json()
    const organizations = data.organizations || []

    return {
      success: true,
      output: {
        organizations,
        paging: {
          next_page: data.next_page ?? null,
          previous_page: data.previous_page ?? null,
          count: data.count || organizations.length,
        },
        metadata: {
          total_returned: organizations.length,
          has_more: !!data.next_page,
        },
        success: true,
      },
    }
  },

  outputs: {
    organizations: { type: 'array', description: 'Array of organization objects' },
    paging: {
      type: 'object',
      description: 'Pagination information',
      properties: {
        next_page: { type: 'string', description: 'URL for next page of results', optional: true },
        previous_page: {
          type: 'string',
          description: 'URL for previous page of results',
          optional: true,
        },
        count: { type: 'number', description: 'Total count of organizations' },
      },
    },
    metadata: {
      type: 'object',
      description: 'Response metadata',
      properties: {
        total_returned: {
          type: 'number',
          description: 'Number of organizations returned in this response',
        },
        has_more: { type: 'boolean', description: 'Whether more organizations are available' },
      },
    },
  },
}
