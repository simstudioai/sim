import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type {
  OktaAssignUserRoleParams,
  OktaAssignUserRoleResponse,
  OktaRoleAssignment,
} from '@/tools/okta/types'
import { isOktaFlagEnabled, oktaHeaders, throwOktaError } from '@/tools/okta/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('OktaAssignUserRole')

export const oktaAssignUserRoleTool: ToolConfig<
  OktaAssignUserRoleParams,
  OktaAssignUserRoleResponse
> = {
  id: 'okta_assign_user_role',
  name: 'Assign User Role in Okta',
  description:
    'Grant a user an administrator role. Use a standard role type such as USER_ADMIN or HELP_DESK_ADMIN, or CUSTOM together with a custom role ID and a resource set ID. This grants privileged access, so confirm the role is the least privilege that fits.',
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
      description: 'Okta user ID (not a login or email) to assign the admin role to',
    },
    roleType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Role type to assign: SUPER_ADMIN, ORG_ADMIN, APP_ADMIN, USER_ADMIN, HELP_DESK_ADMIN, READ_ONLY_ADMIN, API_ACCESS_MANAGEMENT_ADMIN, GROUP_MEMBERSHIP_ADMIN, REPORT_ADMIN, WORKFLOWS_ADMIN, ACCESS_CERTIFICATIONS_ADMIN, ACCESS_REQUESTS_ADMIN, or CUSTOM',
    },
    customRoleId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom role ID. Required when the role type is CUSTOM',
    },
    resourceSetId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Resource set ID the custom role applies to. Required when the role type is CUSTOM',
    },
    disableNotifications: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Grant the user third-party admin status, which suppresses Okta admin notifications (default: false)',
    },
  },

  request: {
    url: (params) => {
      const domain = validateOktaDomain(params.domain)
      const base = `https://${domain}/api/v1/users/${encodeURIComponent(params.userId.trim())}/roles`
      return params.disableNotifications === undefined
        ? base
        : `${base}?disableNotifications=${isOktaFlagEnabled(params.disableNotifications)}`
    },
    method: 'POST',
    headers: (params) => oktaHeaders(params.apiKey),
    body: (params) => {
      if (params.roleType === 'CUSTOM') {
        return {
          type: 'CUSTOM',
          role: params.customRoleId,
          'resource-set': params.resourceSetId,
        }
      }
      return { type: params.roleType }
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      await throwOktaError(response, logger, 'Failed to assign user role in Okta')
    }

    const role: OktaRoleAssignment = await response.json()

    return {
      success: true,
      output: {
        id: role.id ?? null,
        label: role.label ?? null,
        type: role.type,
        status: role.status ?? null,
        created: role.created ?? null,
        lastUpdated: role.lastUpdated ?? null,
        assignmentType: role.assignmentType ?? null,
        role: role.role ?? null,
        resourceSet: role['resource-set'] ?? null,
        assigned: true,
        success: true,
      },
    }
  },

  outputs: {
    id: {
      type: 'string',
      description: 'Role assignment ID, which is what Remove User Role takes',
      optional: true,
    },
    label: { type: 'string', description: 'Role label', optional: true },
    type: { type: 'string', description: 'Assigned role type' },
    status: { type: 'string', description: 'Role status', optional: true },
    created: { type: 'string', description: 'Assignment timestamp', optional: true },
    lastUpdated: { type: 'string', description: 'Last update timestamp', optional: true },
    assignmentType: {
      type: 'string',
      description: 'How the role was assigned (USER, GROUP, CLIENT)',
      optional: true,
    },
    role: { type: 'string', description: 'Custom role ID, for custom roles', optional: true },
    resourceSet: {
      type: 'string',
      description: 'Resource set ID, for custom roles',
      optional: true,
    },
    assigned: { type: 'boolean', description: 'Whether the role was assigned' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
