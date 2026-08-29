import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type {
  OktaAppGroupAssignment,
  OktaAssignGroupToAppParams,
  OktaAssignGroupToAppResponse,
} from '@/tools/okta/types'
import { oktaHeaders, throwOktaError } from '@/tools/okta/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

const logger = createLogger('OktaAssignGroupToApp')

export const oktaAssignGroupToAppTool: ToolConfig<
  OktaAssignGroupToAppParams,
  OktaAssignGroupToAppResponse
> = {
  id: 'okta_assign_group_to_app',
  name: 'Assign Group to Application in Okta',
  description:
    'Assign a group to an Okta application so every member of the group inherits access to it.',
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
    appId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Application ID to assign the group to',
    },
    groupId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Group ID to assign',
    },
    priority: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Assignment priority, which resolves conflicting profile mappings when a user belongs to several assigned groups',
    },
  },

  request: {
    url: (params) => {
      const domain = validateOktaDomain(params.domain)
      return `https://${domain}/api/v1/apps/${safeUrlPathSegment(params.appId, 'appId')}/groups/${safeUrlPathSegment(params.groupId, 'groupId')}`
    },
    method: 'PUT',
    headers: (params) => oktaHeaders(params.apiKey),
    body: (params) => (params.priority === undefined ? {} : { priority: params.priority }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      await throwOktaError(response, logger, 'Failed to assign group to application in Okta')
    }

    const assignment: OktaAppGroupAssignment = await response.json()

    return {
      success: true,
      output: {
        id: assignment.id,
        priority: assignment.priority ?? null,
        lastUpdated: assignment.lastUpdated,
        profile: assignment.profile ?? null,
        assigned: true,
        success: true,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Assigned group ID' },
    priority: { type: 'number', description: 'Assignment priority', optional: true },
    lastUpdated: { type: 'string', description: 'Last update timestamp' },
    profile: {
      type: 'json',
      description: 'App-specific profile attributes, whose shape is set by the app schema',
      optional: true,
    },
    assigned: { type: 'boolean', description: 'Whether the group was assigned' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
