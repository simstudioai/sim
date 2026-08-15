import type {
  GoogleWorkspaceAdminListRolesParams,
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

interface ListRolesApiResponse {
  items?: unknown[]
  nextPageToken?: string
}

export const listRolesTool: ToolConfig<
  GoogleWorkspaceAdminListRolesParams,
  GoogleWorkspaceAdminResponse
> = {
  id: 'google_workspace_admin_list_roles',
  name: 'Google Workspace Admin List Roles',
  description: 'List the administrator roles defined in a Google Workspace account',
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
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of roles to return. Example: 100',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Token for fetching the next page of results',
    },
  },

  request: {
    url: (params) => {
      const customer = params.customer || DEFAULT_CUSTOMER
      const url = new URL(`${DIRECTORY_API_BASE}/customer/${encodeURIComponent(customer)}/roles`)
      appendQueryParams(url, {
        maxResults: params.maxResults,
        pageToken: params.pageToken,
      })
      return url.toString()
    },
    method: 'GET',
    headers: adminHeaders,
  },

  transformResponse: async (response) => {
    const data = await readAdminJson<ListRolesApiResponse>(response, 'Failed to list roles')
    return {
      success: true,
      output: {
        roles: data.items ?? [],
        nextPageToken: data.nextPageToken ?? undefined,
      },
    }
  },

  outputs: {
    roles: {
      type: 'json',
      description: 'Array of Role resources',
      items: {
        type: 'json',
        properties: {
          roleId: { type: 'string', description: 'Unique ID of the role' },
          roleName: { type: 'string', description: 'Name of the role' },
          roleDescription: { type: 'string', description: 'Description of the role' },
          rolePrivileges: {
            type: 'json',
            description: 'Privileges granted, each with serviceId and privilegeName',
          },
          isSystemRole: { type: 'boolean', description: 'Whether this is a built-in system role' },
          isSuperAdminRole: {
            type: 'boolean',
            description: 'Whether this is the super administrator role',
          },
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
