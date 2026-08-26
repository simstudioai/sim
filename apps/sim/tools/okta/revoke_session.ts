import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type { OktaRevokeSessionParams, OktaRevokeSessionResponse } from '@/tools/okta/types'
import { oktaHeaders, throwOktaError } from '@/tools/okta/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

const logger = createLogger('OktaRevokeSession')

export const oktaRevokeSessionTool: ToolConfig<OktaRevokeSessionParams, OktaRevokeSessionResponse> =
  {
    id: 'okta_revoke_session',
    name: 'Revoke Session in Okta',
    description:
      'Revoke a single Okta session by ID, ending that sign-in immediately. Destructive and irreversible: the affected user must sign in again on that device.',
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
      sessionId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Session ID to revoke',
      },
    },

    request: {
      url: (params) => {
        const domain = validateOktaDomain(params.domain)
        return `https://${domain}/api/v1/sessions/${safeUrlPathSegment(params.sessionId, 'sessionId')}`
      },
      method: 'DELETE',
      headers: (params) => oktaHeaders(params.apiKey),
    },

    transformResponse: async (response: Response, params) => {
      if (!response.ok) {
        await throwOktaError(response, logger, 'Failed to revoke session in Okta')
      }

      return {
        success: true,
        output: {
          sessionId: params?.sessionId ?? '',
          revoked: true,
          success: true,
        },
      }
    },

    outputs: {
      sessionId: { type: 'string', description: 'Revoked session ID' },
      revoked: { type: 'boolean', description: 'Whether the session was revoked' },
      success: { type: 'boolean', description: 'Operation success status' },
    },
  }
