import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type { OktaGetSessionParams, OktaGetSessionResponse, OktaSession } from '@/tools/okta/types'
import { oktaHeaders, throwOktaError } from '@/tools/okta/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

const logger = createLogger('OktaGetSession')

export const oktaGetSessionTool: ToolConfig<OktaGetSessionParams, OktaGetSessionResponse> = {
  id: 'okta_get_session',
  name: 'Get Session from Okta',
  description:
    'Retrieve an Okta session by ID, including who it belongs to, when it expires, and which authentication methods were used to establish it.',
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
      description: 'Session ID to look up',
    },
  },

  request: {
    url: (params) => {
      const domain = validateOktaDomain(params.domain)
      return `https://${domain}/api/v1/sessions/${safeUrlPathSegment(params.sessionId, 'sessionId')}`
    },
    method: 'GET',
    headers: (params) => oktaHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      await throwOktaError(response, logger, 'Failed to get session from Okta')
    }

    const session: OktaSession = await response.json()

    return {
      success: true,
      output: {
        id: session.id,
        login: session.login ?? null,
        userId: session.userId ?? null,
        status: session.status ?? null,
        createdAt: session.createdAt ?? null,
        expiresAt: session.expiresAt ?? null,
        lastPasswordVerification: session.lastPasswordVerification ?? null,
        lastFactorVerification: session.lastFactorVerification ?? null,
        amr: session.amr ?? [],
        idpId: session.idp?.id ?? null,
        idpType: session.idp?.type ?? null,
        success: true,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Session ID' },
    login: { type: 'string', description: 'Login of the session user', optional: true },
    userId: { type: 'string', description: 'ID of the session user', optional: true },
    status: {
      type: 'string',
      description: 'Session status (ACTIVE, MFA_ENROLL, MFA_REQUIRED)',
      optional: true,
    },
    createdAt: { type: 'string', description: 'Session creation timestamp', optional: true },
    expiresAt: { type: 'string', description: 'Session expiry timestamp', optional: true },
    lastPasswordVerification: {
      type: 'string',
      description: 'Timestamp of the last password verification',
      optional: true,
    },
    lastFactorVerification: {
      type: 'string',
      description: 'Timestamp of the last factor verification',
      optional: true,
    },
    amr: {
      type: 'array',
      description: 'Authentication methods used to establish the session',
      items: { type: 'string', description: 'Authentication method reference' },
    },
    idpId: { type: 'string', description: 'Identity provider ID', optional: true },
    idpType: { type: 'string', description: 'Identity provider type', optional: true },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
