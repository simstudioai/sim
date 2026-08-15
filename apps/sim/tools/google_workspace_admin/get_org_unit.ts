import type {
  GoogleWorkspaceAdminOrgUnitKeyParams,
  GoogleWorkspaceAdminResponse,
} from '@/tools/google_workspace_admin/types'
import {
  adminHeaders,
  DEFAULT_CUSTOMER,
  DIRECTORY_API_BASE,
  encodeOrgUnitPath,
  readAdminJson,
} from '@/tools/google_workspace_admin/utils'
import type { ToolConfig } from '@/tools/types'

export const getOrgUnitTool: ToolConfig<
  GoogleWorkspaceAdminOrgUnitKeyParams,
  GoogleWorkspaceAdminResponse
> = {
  id: 'google_workspace_admin_get_org_unit',
  name: 'Google Workspace Admin Get Org Unit',
  description: 'Read a single Google Workspace organizational unit',
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
      description: 'Full path of the org unit (e.g. /Sales/West), or its unique org unit ID',
    },
  },

  request: {
    url: (params) => {
      const customer = params.customerId || DEFAULT_CUSTOMER
      return `${DIRECTORY_API_BASE}/customer/${encodeURIComponent(customer)}/orgunits/${encodeOrgUnitPath(params.orgUnitPath)}`
    },
    method: 'GET',
    headers: adminHeaders,
  },

  transformResponse: async (response) => {
    const data = await readAdminJson<unknown>(response, 'Failed to get org unit')
    return {
      success: true,
      output: { orgUnit: data },
    }
  },

  outputs: {
    orgUnit: {
      type: 'json',
      description: 'The OrgUnit resource',
      properties: {
        orgUnitId: { type: 'string', description: 'Unique ID of the org unit' },
        orgUnitPath: { type: 'string', description: 'Full path of the org unit' },
        name: { type: 'string', description: 'Display name of the org unit' },
        description: { type: 'string', description: 'Description of the org unit' },
        parentOrgUnitId: { type: 'string', description: 'Unique ID of the parent org unit' },
        parentOrgUnitPath: { type: 'string', description: 'Full path of the parent org unit' },
      },
    },
  },
}
