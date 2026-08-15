import type {
  GoogleWorkspaceAdminListUsersParams,
  GoogleWorkspaceAdminResponse,
} from '@/tools/google_workspace_admin/types'
import {
  adminHeaders,
  appendQueryParams,
  DEFAULT_CUSTOMER,
  DIRECTORY_API_BASE,
  readAdminJson,
} from '@/tools/google_workspace_admin/utils'
import type { ToolConfig } from '@/tools/types'

interface ListUsersApiResponse {
  users?: unknown[]
  nextPageToken?: string
}

export const listUsersTool: ToolConfig<
  GoogleWorkspaceAdminListUsersParams,
  GoogleWorkspaceAdminResponse
> = {
  id: 'google_workspace_admin_list_users',
  name: 'Google Workspace Admin List Users',
  description: 'List Google Workspace directory users for a customer or domain',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'google-workspace-admin',
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
      description: 'Customer ID, or "my_customer" for the authenticated account (default)',
    },
    domain: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Domain to list users from (e.g. example.com). Used instead of customer',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Directory search query filtering the results (e.g. "orgUnitPath=/Sales" or "email:jane*")',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of users to return (1-500). Example: 100',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Token for fetching the next page of results',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Field to sort by: EMAIL, FAMILY_NAME, or GIVEN_NAME',
    },
    sortOrder: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Sort direction: ASCENDING or DESCENDING',
    },
    projection: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Fields to include for each user: BASIC, CUSTOM, or FULL',
    },
    showDeleted: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Return recently deleted users instead of active ones',
    },
    viewType: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Whether to read the admin_view or the domain_public view of each user',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`${DIRECTORY_API_BASE}/users`)

      if (params.customer) {
        url.searchParams.set('customer', params.customer)
      } else if (!params.domain) {
        url.searchParams.set('customer', DEFAULT_CUSTOMER)
      }

      appendQueryParams(url, {
        domain: params.domain,
        query: params.query,
        maxResults: params.maxResults,
        pageToken: params.pageToken,
        orderBy: params.orderBy,
        sortOrder: params.sortOrder,
        projection: params.projection,
        viewType: params.viewType,
      })

      if (params.showDeleted) {
        url.searchParams.set('showDeleted', 'true')
      }

      return url.toString()
    },
    method: 'GET',
    headers: adminHeaders,
  },

  transformResponse: async (response) => {
    const data = await readAdminJson<ListUsersApiResponse>(response, 'Failed to list users')
    return {
      success: true,
      output: {
        users: data.users ?? [],
        nextPageToken: data.nextPageToken ?? undefined,
      },
    }
  },

  outputs: {
    users: {
      type: 'json',
      description: 'Array of Directory API User resources',
      items: {
        type: 'json',
        properties: {
          id: { type: 'string', description: 'Unique user ID' },
          primaryEmail: { type: 'string', description: 'Primary email address' },
          name: { type: 'json', description: 'Name object with givenName, familyName, fullName' },
          isAdmin: { type: 'boolean', description: 'Whether the user is a super administrator' },
          suspended: { type: 'boolean', description: 'Whether the account is suspended' },
          orgUnitPath: { type: 'string', description: 'Org unit the user belongs to' },
          lastLoginTime: { type: 'string', description: 'Last login timestamp' },
        },
      },
    },
    nextPageToken: {
      type: 'string',
      description: 'Token for fetching the next page of results',
      optional: true,
    },
  },
}
