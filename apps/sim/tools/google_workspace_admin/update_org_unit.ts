import type {
  GoogleWorkspaceAdminResponse,
  GoogleWorkspaceAdminUpdateOrgUnitParams,
} from '@/tools/google_workspace_admin/types'
import {
  adminHeaders,
  DEFAULT_CUSTOMER,
  DIRECTORY_API_BASE,
  encodeOrgUnitPath,
  readAdminJson,
} from '@/tools/google_workspace_admin/utils'
import type { ToolConfig } from '@/tools/types'

export const updateOrgUnitTool: ToolConfig<
  GoogleWorkspaceAdminUpdateOrgUnitParams,
  GoogleWorkspaceAdminResponse
> = {
  id: 'google_workspace_admin_update_org_unit',
  name: 'Google Workspace Admin Update Org Unit',
  description: 'Rename, re-describe, or re-parent a Google Workspace organizational unit',
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
    orgUnitPath: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Full path of the org unit to update (e.g. /Sales/West), or its unique org unit ID',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New name for the org unit',
    },
    parentOrgUnitPath: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Full path of a new parent org unit. Moving an org unit moves every user and device inside it',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New description for the org unit',
    },
  },

  request: {
    url: (params) => {
      const customer = params.customerId || DEFAULT_CUSTOMER
      return `${DIRECTORY_API_BASE}/customer/${encodeURIComponent(customer)}/orgunits/${encodeOrgUnitPath(params.orgUnitPath)}`
    },
    method: 'PATCH',
    headers: adminHeaders,
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.name) body.name = params.name
      if (params.parentOrgUnitPath) body.parentOrgUnitPath = params.parentOrgUnitPath
      if (params.description !== undefined) body.description = params.description
      return JSON.stringify(body)
    },
  },

  transformResponse: async (response) => {
    const data = await readAdminJson<unknown>(response, 'Failed to update org unit')
    return {
      success: true,
      output: { orgUnit: data },
    }
  },

  outputs: {
    orgUnit: {
      type: 'json',
      description: 'The updated OrgUnit resource',
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
