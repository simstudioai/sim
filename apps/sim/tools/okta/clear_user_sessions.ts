import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type { OktaClearUserSessionsParams, OktaClearUserSessionsResponse } from '@/tools/okta/types'
import { isOktaFlagEnabled, oktaHeaders, throwOktaError } from '@/tools/okta/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('OktaClearUserSessions')

export const oktaClearUserSessionsTool: ToolConfig<
  OktaClearUserSessionsParams,
  OktaClearUserSessionsResponse
> = {
  id: 'okta_clear_user_sessions',
  name: 'Clear User Sessions in Okta',
  description:
    'Revoke every active Okta session for a user, signing them out of all devices immediately. Destructive and irreversible: the user must sign in again. Optionally also revokes their OAuth and OpenID Connect tokens, and clears remembered factors.',
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
      description: 'User ID or login whose sessions will be revoked',
    },
    oauthTokens: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Also revoke the user OpenID Connect and OAuth refresh and access tokens (default: false)',
    },
    forgetDevices: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Clear the user remembered factors for all devices (default: true)',
    },
  },

  request: {
    url: (params) => {
      const domain = validateOktaDomain(params.domain)
      const queryParams = new URLSearchParams()

      if (params.oauthTokens !== undefined) {
        queryParams.append('oauthTokens', String(isOktaFlagEnabled(params.oauthTokens)))
      }
      if (params.forgetDevices !== undefined) {
        queryParams.append('forgetDevices', String(isOktaFlagEnabled(params.forgetDevices)))
      }

      const queryString = queryParams.toString()
      const base = `https://${domain}/api/v1/users/${encodeURIComponent(params.userId.trim())}/sessions`
      return queryString ? `${base}?${queryString}` : base
    },
    method: 'DELETE',
    headers: (params) => oktaHeaders(params.apiKey),
  },

  transformResponse: async (response: Response, params) => {
    if (!response.ok) {
      await throwOktaError(response, logger, 'Failed to clear user sessions in Okta')
    }

    return {
      success: true,
      output: {
        userId: params?.userId ?? '',
        cleared: true,
        success: true,
      },
    }
  },

  outputs: {
    userId: { type: 'string', description: 'User whose sessions were revoked' },
    cleared: { type: 'boolean', description: 'Whether the sessions were revoked' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
