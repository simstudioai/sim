import type {
  GoogleWorkspaceAdminOrgUnitKeyParams,
  GoogleWorkspaceAdminResponse,
} from '@/tools/google_workspace_admin/types'
import {
  adminHeaders,
  assertAdminSuccess,
  DEFAULT_CUSTOMER,
  DIRECTORY_API_BASE,
  encodeOrgUnitPath,
} from '@/tools/google_workspace_admin/utils'
import type { ToolConfig } from '@/tools/types'

export const deleteOrgUnitTool: ToolConfig<
  GoogleWorkspaceAdminOrgUnitKeyParams,
  GoogleWorkspaceAdminResponse
> = {
  id: 'google_workspace_admin_delete_org_unit',
  name: 'Google Workspace Admin Delete Org Unit',
  description:
    'Delete a Google Workspace organizational unit. The org unit must have no child org units, and its policies stop applying',
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
        'Full path of the org unit to delete (e.g. /Sales/West), or its unique org unit ID. This is destructive',
    },
  },

  request: {
    url: (params) => {
      const customer = params.customerId || DEFAULT_CUSTOMER
      return `${DIRECTORY_API_BASE}/customer/${encodeURIComponent(customer)}/orgunits/${encodeOrgUnitPath(params.orgUnitPath)}`
    },
    method: 'DELETE',
    headers: adminHeaders,
  },

  transformResponse: async (response) => {
    await assertAdminSuccess(response, 'Failed to delete org unit')
    return {
      success: true,
      output: { message: 'Org unit deleted successfully' },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Confirmation that the org unit was deleted' },
  },
}
