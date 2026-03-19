import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type {
  OktaApiError,
  OktaRemoveUserFromGroupParams,
  OktaRemoveUserFromGroupResponse,
} from '@/tools/okta/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('OktaRemoveUserFromGroup')

export const oktaRemoveUserFromGroupTool: ToolConfig<
  OktaRemoveUserFromGroupParams,
  OktaRemoveUserFromGroupResponse
> = {
  id: 'okta_remove_user_from_group',
  name: 'Remove User from Group in Okta',
  description: 'Remove a user from a group in your Okta organization',
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
    groupId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Group ID to remove the user from',
    },
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'User ID to remove from the group',
    },
  },

  request: {
    url: (params) => {
      const domain = validateOktaDomain(params.domain)
      return `https://${domain}/api/v1/groups/${encodeURIComponent(params.groupId)}/users/${encodeURIComponent(params.userId)}`
    },
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `SSWS ${params.apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response, params) => {
    if (!response.ok) {
      let error: OktaApiError = {}
      try {
        error = await response.json()
      } catch {
        // empty response body
      }
      logger.error('Okta API request failed', { data: error, status: response.status })
      throw new Error(error.errorSummary || 'Failed to remove user from group in Okta')
    }

    return {
      success: true,
      output: {
        groupId: params?.groupId ?? '',
        userId: params?.userId ?? '',
        removed: true,
        success: true,
      },
    }
  },

  outputs: {
    groupId: { type: 'string', description: 'Group ID' },
    userId: { type: 'string', description: 'User ID removed from the group' },
    removed: { type: 'boolean', description: 'Whether the user was removed' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
