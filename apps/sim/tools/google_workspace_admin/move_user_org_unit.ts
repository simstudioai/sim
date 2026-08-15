import type {
  GoogleWorkspaceAdminMoveUserParams,
  GoogleWorkspaceAdminResponse,
} from '@/tools/google_workspace_admin/types'
import {
  adminHeaders,
  DIRECTORY_API_BASE,
  readAdminJson,
} from '@/tools/google_workspace_admin/utils'
import type { ToolConfig } from '@/tools/types'

export const moveUserOrgUnitTool: ToolConfig<
  GoogleWorkspaceAdminMoveUserParams,
  GoogleWorkspaceAdminResponse
> = {
  id: 'google_workspace_admin_move_user_org_unit',
  name: 'Google Workspace Admin Move User Org Unit',
  description:
    'Move a Google Workspace user into a different organizational unit, changing the policies that apply to them',
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
    userKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'User to move, given as their primary email address, alias email address, or unique user ID',
    },
    orgUnitPath: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Full path of the destination org unit, starting with a slash (e.g. /Sales/West). Use / for the top-level org unit',
    },
  },

  request: {
    url: (params) => `${DIRECTORY_API_BASE}/users/${encodeURIComponent(params.userKey)}`,
    method: 'PATCH',
    headers: adminHeaders,
    body: (params) => JSON.stringify({ orgUnitPath: params.orgUnitPath }),
  },

  transformResponse: async (response) => {
    const data = await readAdminJson<unknown>(response, 'Failed to move user org unit')
    return {
      success: true,
      output: { user: data },
    }
  },

  outputs: {
    user: {
      type: 'json',
      description: 'The updated Directory API User resource',
      properties: {
        id: { type: 'string', description: 'Unique user ID' },
        primaryEmail: { type: 'string', description: 'Primary email address' },
        orgUnitPath: { type: 'string', description: 'Org unit the user now belongs to' },
      },
    },
  },
}
