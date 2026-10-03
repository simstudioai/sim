import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type { OktaRemoveUserFromAppParams, OktaRemoveUserFromAppResponse } from '@/tools/okta/types'
import { isOktaFlagEnabled, oktaHeaders, throwOktaError } from '@/tools/okta/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('OktaRemoveUserFromApp')

export const oktaRemoveUserFromAppTool: ToolConfig<
  OktaRemoveUserFromAppParams,
  OktaRemoveUserFromAppResponse
> = {
  id: 'okta_remove_user_from_app',
  name: 'Remove User from Application in Okta',
  description:
    'Unassign a user from an Okta application, revoking their access. Destructive and irreversible: the app profile for that user is permanently removed, and if provisioning is enabled the downstream account is deactivated.',
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
      description: 'Application ID to remove the user from',
    },
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Okta user ID to unassign',
    },
    sendEmail: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Send a deactivation email to the administrator (default: false)',
    },
  },

  request: {
    url: (params) => {
      const domain = validateOktaDomain(params.domain)
      const base = `https://${domain}/api/v1/apps/${encodeURIComponent(params.appId.trim())}/users/${encodeURIComponent(params.userId.trim())}`
      return params.sendEmail === undefined
        ? base
        : `${base}?sendEmail=${isOktaFlagEnabled(params.sendEmail)}`
    },
    method: 'DELETE',
    headers: (params) => oktaHeaders(params.apiKey),
  },

  transformResponse: async (response: Response, params) => {
    if (!response.ok) {
      await throwOktaError(response, logger, 'Failed to remove user from application in Okta')
    }

    return {
      success: true,
      output: {
        appId: params?.appId ?? '',
        userId: params?.userId ?? '',
        removed: true,
        success: true,
      },
    }
  },

  outputs: {
    appId: { type: 'string', description: 'Application ID' },
    userId: { type: 'string', description: 'User unassigned from the application' },
    removed: { type: 'boolean', description: 'Whether the user was unassigned' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
