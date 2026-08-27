import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type { OktaRemoveUserRoleParams, OktaRemoveUserRoleResponse } from '@/tools/okta/types'
import { oktaHeaders, throwOktaError } from '@/tools/okta/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('OktaRemoveUserRole')

export const oktaRemoveUserRoleTool: ToolConfig<
  OktaRemoveUserRoleParams,
  OktaRemoveUserRoleResponse
> = {
  id: 'okta_remove_user_role',
  name: 'Remove User Role in Okta',
  description:
    'Revoke an administrator role from a user. Destructive: the user immediately loses the admin permissions that role granted. Takes the role assignment ID, not the role type, which List User Roles returns as the role id field.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Okta API token for authentication',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Okta domain (e.g., dev-123456.okta.com)',
    },
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'User ID or login to revoke the admin role from',
    },
    roleAssignmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Role assignment ID to revoke, as returned by List User Roles. For a custom role this is the resource set binding ID',
    },
  },

  request: {
    url: (params) => {
      const domain = validateOktaDomain(params.domain)
      return `https://${domain}/api/v1/users/${encodeURIComponent(params.userId.trim())}/roles/${encodeURIComponent(params.roleAssignmentId.trim())}`
    },
    method: 'DELETE',
    headers: (params) => oktaHeaders(params.apiKey),
  },

  transformResponse: async (response: Response, params) => {
    if (!response.ok) {
      await throwOktaError(response, logger, 'Failed to remove user role in Okta')
    }

    return {
      success: true,
      output: {
        userId: params?.userId ?? '',
        roleAssignmentId: params?.roleAssignmentId ?? '',
        removed: true,
        success: true,
      },
    }
  },

  outputs: {
    userId: { type: 'string', description: 'User the role was revoked from' },
    roleAssignmentId: { type: 'string', description: 'Revoked role assignment ID' },
    removed: { type: 'boolean', description: 'Whether the role was revoked' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
