import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type {
  OktaRemoveGroupFromAppParams,
  OktaRemoveGroupFromAppResponse,
} from '@/tools/okta/types'
import { oktaHeaders, throwOktaError } from '@/tools/okta/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('OktaRemoveGroupFromApp')

export const oktaRemoveGroupFromAppTool: ToolConfig<
  OktaRemoveGroupFromAppParams,
  OktaRemoveGroupFromAppResponse
> = {
  id: 'okta_remove_group_from_app',
  name: 'Remove Group from Application in Okta',
  description:
    'Unassign a group from an Okta application. Destructive: every member who had access only through this group loses access to the app.',
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
      description: 'Application ID to remove the group from',
    },
    groupId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Group ID to unassign',
    },
  },

  request: {
    url: (params) => {
      const domain = validateOktaDomain(params.domain)
      return `https://${domain}/api/v1/apps/${encodeURIComponent(params.appId.trim())}/groups/${encodeURIComponent(params.groupId.trim())}`
    },
    method: 'DELETE',
    headers: (params) => oktaHeaders(params.apiKey),
  },

  transformResponse: async (response: Response, params) => {
    if (!response.ok) {
      await throwOktaError(response, logger, 'Failed to remove group from application in Okta')
    }

    return {
      success: true,
      output: {
        appId: params?.appId ?? '',
        groupId: params?.groupId ?? '',
        removed: true,
        success: true,
      },
    }
  },

  outputs: {
    appId: { type: 'string', description: 'Application ID' },
    groupId: { type: 'string', description: 'Group unassigned from the application' },
    removed: { type: 'boolean', description: 'Whether the group was unassigned' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
