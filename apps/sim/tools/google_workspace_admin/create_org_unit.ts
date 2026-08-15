import type {
  GoogleWorkspaceAdminCreateOrgUnitParams,
  GoogleWorkspaceAdminResponse,
} from '@/tools/google_workspace_admin/types'
import {
  adminHeaders,
  DEFAULT_CUSTOMER,
  DIRECTORY_API_BASE,
  readAdminJson,
} from '@/tools/google_workspace_admin/utils'
import type { ToolConfig } from '@/tools/types'

export const createOrgUnitTool: ToolConfig<
  GoogleWorkspaceAdminCreateOrgUnitParams,
  GoogleWorkspaceAdminResponse
> = {
  id: 'google_workspace_admin_create_org_unit',
  name: 'Google Workspace Admin Create Org Unit',
  description: 'Create a new organizational unit in a Google Workspace account',
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
    customerId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Customer ID, or "my_customer" for the authenticated account (default)',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the new org unit (e.g. West)',
    },
    parentOrgUnitPath: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Full path of the parent org unit (e.g. /Sales). Use / for the top level',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the org unit',
    },
  },

  request: {
    url: (params) => {
      const customer = params.customerId || DEFAULT_CUSTOMER
      return `${DIRECTORY_API_BASE}/customer/${encodeURIComponent(customer)}/orgunits`
    },
    method: 'POST',
    headers: adminHeaders,
    body: (params) => {
      const body: Record<string, unknown> = {
        name: params.name,
        parentOrgUnitPath: params.parentOrgUnitPath,
      }
      if (params.description) body.description = params.description
      return JSON.stringify(body)
    },
  },

  transformResponse: async (response) => {
    const data = await readAdminJson<unknown>(response, 'Failed to create org unit')
    return {
      success: true,
      output: { orgUnit: data },
    }
  },

  outputs: {
    orgUnit: {
      type: 'json',
      description: 'The created OrgUnit resource',
      properties: {
        orgUnitId: { type: 'string', description: 'Unique ID of the org unit' },
        orgUnitPath: { type: 'string', description: 'Full path of the org unit' },
        name: { type: 'string', description: 'Display name of the org unit' },
        description: { type: 'string', description: 'Description of the org unit' },
        parentOrgUnitPath: { type: 'string', description: 'Full path of the parent org unit' },
      },
    },
  },
}
