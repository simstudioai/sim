import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type {
  OktaApiError,
  OktaDeleteGroupParams,
  OktaDeleteGroupResponse,
} from '@/tools/okta/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('OktaDeleteGroup')

export const oktaDeleteGroupTool: ToolConfig<OktaDeleteGroupParams, OktaDeleteGroupResponse> = {
  id: 'okta_delete_group',
  name: 'Delete Group from Okta',
  description:
    'Delete a group from your Okta organization. Groups of OKTA_GROUP or APP_GROUP type can be removed.',
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
      description: 'Group ID to delete',
    },
  },

  request: {
    url: (params) => {
      const domain = validateOktaDomain(params.domain)
      return `https://${domain}/api/v1/groups/${encodeURIComponent(params.groupId)}`
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
      throw new Error(error.errorSummary || 'Failed to delete group from Okta')
    }

    return {
      success: true,
      output: {
        groupId: params?.groupId ?? '',
        deleted: true,
        success: true,
      },
    }
  },

  outputs: {
    groupId: { type: 'string', description: 'Deleted group ID' },
    deleted: { type: 'boolean', description: 'Whether the group was deleted' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
