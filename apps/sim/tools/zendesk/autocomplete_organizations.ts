import type { ToolConfig } from '@/tools/types'
import {
  buildZendeskUrl,
  handleZendeskError,
  METADATA_OUTPUT,
  ORGANIZATIONS_ARRAY_OUTPUT,
  PAGING_OUTPUT,
} from '@/tools/zendesk/types'

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
      after_cursor: string | null
      has_more: boolean
      next_page?: string | null
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
      visibility: 'user-or-llm',
      description: 'Organization name prefix to search for (e.g., "Acme")',
    },
    perPage: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Results per page as a number string (default: "100", max: "100")',
    },
    page: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number for pagination (1-based)',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      queryParams.append('name', params.name)
      if (params.perPage) queryParams.append('per_page', params.perPage)
      if (params.page) queryParams.append('page', params.page)

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
    const hasMore = data.next_page !== null && data.next_page !== undefined

    return {
      success: true,
      output: {
        organizations,
        // /organizations/autocomplete uses offset pagination (page/per_page), not cursor pagination.
        // after_cursor is always null; use next_page URL or page param for subsequent pages.
        paging: {
          after_cursor: null,
          has_more: hasMore,
          next_page: data.next_page ?? null,
        },
        metadata: {
          total_returned: organizations.length,
          has_more: hasMore,
        },
        success: true,
      },
    }
  },

  outputs: {
    organizations: ORGANIZATIONS_ARRAY_OUTPUT,
    paging: PAGING_OUTPUT,
    metadata: METADATA_OUTPUT,
  },
}
