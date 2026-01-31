import type { GoogleGroupsListParams, GoogleGroupsResponse } from '@/tools/google_groups/types'
import type { ToolConfig } from '@/tools/types'

export const listGroupsTool: ToolConfig<GoogleGroupsListParams, GoogleGroupsResponse> = {
  id: 'google_groups_list_groups',
  name: 'Google Groups List Groups',
  description: 'List all groups in a Google Workspace domain',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'google-groups',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token',
    },
    customer: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Customer ID or "my_customer" for the authenticated user\'s domain',
    },
    domain: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Domain name to filter groups by',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return (1-200). Example: 50',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Token for fetching the next page of results',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Search query to filter groups (e.g., "email:admin*")',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://admin.googleapis.com/admin/directory/v1/groups')

      // Use my_customer as default if no customer or domain specified
      if (params.customer) {
        url.searchParams.set('customer', params.customer)
      } else if (!params.domain) {
        url.searchParams.set('customer', 'my_customer')
      }

      if (params.domain) {
        url.searchParams.set('domain', params.domain)
      }
      if (params.maxResults) {
        url.searchParams.set('maxResults', String(params.maxResults))
      }
      if (params.pageToken) {
        url.searchParams.set('pageToken', params.pageToken)
      }
      if (params.query) {
        url.searchParams.set('query', params.query)
      }

      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to list groups')
    }
    return {
      success: true,
      output: {
        groups: data.groups || [],
        nextPageToken: data.nextPageToken,
      },
    }
  },

  outputs: {
    groups: { type: 'json', description: 'Array of group objects' },
    nextPageToken: { type: 'string', description: 'Token for fetching next page of results' },
  },
}
