import type {
  MicrosoftAdRevokeSignInSessionsParams,
  MicrosoftAdRevokeSignInSessionsResponse,
} from '@/tools/microsoft_ad/types'
import type { ToolConfig } from '@/tools/types'

export const revokeSignInSessionsTool: ToolConfig<
  MicrosoftAdRevokeSignInSessionsParams,
  MicrosoftAdRevokeSignInSessionsResponse
> = {
  id: 'microsoft_ad_revoke_sign_in_sessions',
  name: 'Revoke Microsoft Entra ID Sign-In Sessions',
  description:
    'Invalidate every refresh token and session cookie issued to a user, forcing them to sign in again on all applications and devices. Revocation can take a few minutes to take effect and does not apply to external users.',
  version: '1.0.0',
  errorExtractor: 'nested-error-object',
  oauth: {
    required: true,
    provider: 'microsoft-ad',
  },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Microsoft Graph API access token',
    },
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'User ID or user principal name whose sessions should be revoked',
    },
  },
  request: {
    url: (params) => {
      const userId = params.userId?.trim()
      if (!userId) throw new Error('User ID is required')
      return `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userId)}/revokeSignInSessions`
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },
  transformResponse: async (response: Response, params?: MicrosoftAdRevokeSignInSessionsParams) => {
    const text = await response.text()
    let revoked = true
    if (text) {
      try {
        revoked = JSON.parse(text).value !== false
      } catch {
        revoked = true
      }
    }
    return {
      success: true,
      output: {
        revoked,
        userId: params?.userId ?? '',
      },
    }
  },
  outputs: {
    revoked: {
      type: 'boolean',
      description: 'Whether Microsoft Graph confirmed the sessions were revoked',
    },
    userId: { type: 'string', description: 'ID of the user whose sessions were revoked' },
  },
}
