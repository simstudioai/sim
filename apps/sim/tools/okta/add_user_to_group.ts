import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type {
  OktaAddUserToGroupParams,
  OktaAddUserToGroupResponse,
  OktaApiError,
} from '@/tools/okta/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('OktaAddUserToGroup')

export const oktaAddUserToGroupTool: ToolConfig<
  OktaAddUserToGroupParams,
  OktaAddUserToGroupResponse
> = {
  id: 'okta_add_user_to_group',
  name: 'Add User to Group in Okta',
  description: 'Add a user to a group in your Okta organization',
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
      description: 'Group ID to add the user to',
    },
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'User ID to add to the group',
    },
  },

  request: {
    url: (params) => {
      const domain = validateOktaDomain(params.domain)
      return `https://${domain}/api/v1/groups/${encodeURIComponent(params.groupId)}/users/${encodeURIComponent(params.userId)}`
    },
    method: 'PUT',
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
      throw new Error(error.errorSummary || 'Failed to add user to group in Okta')
    }

    return {
      success: true,
      output: {
        groupId: params?.groupId ?? '',
        userId: params?.userId ?? '',
        added: true,
        success: true,
      },
    }
  },

  outputs: {
    groupId: { type: 'string', description: 'Group ID' },
    userId: { type: 'string', description: 'User ID added to the group' },
    added: { type: 'boolean', description: 'Whether the user was added' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
