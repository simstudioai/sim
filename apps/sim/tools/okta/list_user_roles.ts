import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type {
  OktaListUserRolesParams,
  OktaListUserRolesResponse,
  OktaRoleAssignment,
} from '@/tools/okta/types'
import { oktaHeaders, throwOktaError } from '@/tools/okta/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('OktaListUserRoles')

export const oktaListUserRolesTool: ToolConfig<OktaListUserRolesParams, OktaListUserRolesResponse> =
  {
    id: 'okta_list_user_roles',
    name: 'List User Roles from Okta',
    description:
      'List the administrator roles assigned to a user. Returns both standard roles and custom role bindings, so you can review who holds privileged access.',
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
        description: 'Okta user ID (not a login or email) to list admin roles for',
      },
    },

    request: {
      url: (params) => {
        const domain = validateOktaDomain(params.domain)
        return `https://${domain}/api/v1/users/${encodeURIComponent(params.userId.trim())}/roles`
      },
      method: 'GET',
      headers: (params) => oktaHeaders(params.apiKey),
    },

    transformResponse: async (response: Response) => {
      if (!response.ok) {
        await throwOktaError(response, logger, 'Failed to list user roles from Okta')
      }

      const data: OktaRoleAssignment[] = await response.json()

      const roles = data.map((role) => ({
        id: role.id ?? null,
        label: role.label ?? null,
        type: role.type,
        status: role.status ?? null,
        created: role.created ?? null,
        lastUpdated: role.lastUpdated ?? null,
        assignmentType: role.assignmentType ?? null,
        role: role.role ?? null,
        resourceSet: role['resource-set'] ?? null,
      }))

      return {
        success: true,
        output: {
          roles,
          count: roles.length,
          success: true,
        },
      }
    },

    outputs: {
      roles: {
        type: 'array',
        description: 'Array of admin role assignments',
        items: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description:
                'Role assignment ID, which is the resource set binding ID for a custom role. Pass this to Remove User Role',
              optional: true,
            },
            label: { type: 'string', description: 'Role label', optional: true },
            type: {
              type: 'string',
              description:
                'Role type (SUPER_ADMIN, ORG_ADMIN, APP_ADMIN, USER_ADMIN, HELP_DESK_ADMIN, READ_ONLY_ADMIN, CUSTOM, etc.)',
            },
            status: {
              type: 'string',
              description: 'Role status (ACTIVE, INACTIVE)',
              optional: true,
            },
            created: { type: 'string', description: 'Assignment timestamp', optional: true },
            lastUpdated: { type: 'string', description: 'Last update timestamp', optional: true },
            assignmentType: {
              type: 'string',
              description: 'How the role was assigned (USER, GROUP, CLIENT)',
              optional: true,
            },
            role: {
              type: 'string',
              description: 'Custom role ID, present only on custom role assignments',
              optional: true,
            },
            resourceSet: {
              type: 'string',
              description: 'Resource set ID, present only on custom role assignments',
              optional: true,
            },
          },
        },
      },
      count: { type: 'number', description: 'Number of role assignments returned' },
      success: { type: 'boolean', description: 'Operation success status' },
    },
  }
