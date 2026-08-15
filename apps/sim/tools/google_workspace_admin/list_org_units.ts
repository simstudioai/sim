import type {
  GoogleWorkspaceAdminListOrgUnitsParams,
  GoogleWorkspaceAdminResponse,
} from '@/tools/google_workspace_admin/types'
import {
  adminHeaders,
  appendQueryParams,
  DEFAULT_CUSTOMER,
  DIRECTORY_API_BASE,
  normalizeEnumValue,
  ORG_UNIT_LIST_TYPE,
  readAdminJson,
} from '@/tools/google_workspace_admin/utils'
import type { ToolConfig } from '@/tools/types'

interface ListOrgUnitsApiResponse {
  organizationUnits?: unknown[]
}

export const listOrgUnitsTool: ToolConfig<
  GoogleWorkspaceAdminListOrgUnitsParams,
  GoogleWorkspaceAdminResponse
> = {
  id: 'google_workspace_admin_list_org_units',
  name: 'Google Workspace Admin List Org Units',
  description: 'List the organizational units in a Google Workspace account',
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
      required: false,
      visibility: 'user-or-llm',
      description: 'Org unit path to list from (e.g. /Sales). Defaults to the top-level org unit',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Which org units to return: children (immediate children, the default), all (all descendants), or allIncludingParent',
    },
  },

  request: {
    url: (params) => {
      const customer = params.customerId || DEFAULT_CUSTOMER
      const url = new URL(`${DIRECTORY_API_BASE}/customer/${encodeURIComponent(customer)}/orgunits`)
      appendQueryParams(url, {
        orgUnitPath: params.orgUnitPath,
        type: normalizeEnumValue('type', params.type, ORG_UNIT_LIST_TYPE),
      })
      return url.toString()
    },
    method: 'GET',
    headers: adminHeaders,
  },

  transformResponse: async (response) => {
    const data = await readAdminJson<ListOrgUnitsApiResponse>(response, 'Failed to list org units')
    return {
      success: true,
      output: { organizationUnits: data.organizationUnits ?? [] },
    }
  },

  outputs: {
    organizationUnits: {
      type: 'json',
      description: 'Array of OrgUnit resources',
      items: {
        type: 'json',
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
  },
}
