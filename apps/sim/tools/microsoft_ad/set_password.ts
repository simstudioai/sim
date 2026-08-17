import type {
  MicrosoftAdSetPasswordParams,
  MicrosoftAdSetPasswordResponse,
} from '@/tools/microsoft_ad/types'
import type { ToolConfig } from '@/tools/types'

export const setPasswordTool: ToolConfig<
  MicrosoftAdSetPasswordParams,
  MicrosoftAdSetPasswordResponse
> = {
  id: 'microsoft_ad_set_password',
  name: 'Set Microsoft Entra ID User Password',
  description:
    'Set a specific password on a user by updating their password profile. Cannot be used for federated users. Requires an administrator role in Microsoft Entra ID.',
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
      description: 'User ID or user principal name whose password should be set',
    },
    password: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The new password. Must satisfy the tenant password policy.',
    },
    forceChangePasswordNextSignIn: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Whether the user must change this password at their next sign-in. Defaults to true.',
    },
    forceChangePasswordNextSignInWithMfa: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Whether the user must complete multifactor authentication before being forced to change the password',
    },
  },
  request: {
    url: (params) => {
      const userId = params.userId?.trim()
      if (!userId) throw new Error('User ID is required')
      return `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userId)}`
    },
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const password = params.password?.trim()
      if (!password) throw new Error('Password is required')
      const passwordProfile: Record<string, unknown> = {
        password,
        forceChangePasswordNextSignIn: params.forceChangePasswordNextSignIn !== false,
      }
      if (params.forceChangePasswordNextSignInWithMfa !== undefined) {
        passwordProfile.forceChangePasswordNextSignInWithMfa =
          params.forceChangePasswordNextSignInWithMfa
      }
      return { passwordProfile }
    },
  },
  transformResponse: async (_response: Response, params?: MicrosoftAdSetPasswordParams) => {
    return {
      success: true,
      output: {
        updated: true,
        userId: params?.userId ?? '',
        forceChangePasswordNextSignIn: params?.forceChangePasswordNextSignIn !== false,
      },
    }
  },
  outputs: {
    updated: { type: 'boolean', description: 'Whether the password was set successfully' },
    userId: { type: 'string', description: 'ID of the user whose password was set' },
    forceChangePasswordNextSignIn: {
      type: 'boolean',
      description: 'Whether the user must change the password at their next sign-in',
    },
  },
}
