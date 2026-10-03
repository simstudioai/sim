import type {
  MicrosoftAdResetPasswordParams,
  MicrosoftAdResetPasswordResponse,
} from '@/tools/microsoft_ad/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Microsoft Graph exposes a user's password authentication method under a fixed, publicly
 * documented object id that is identical for every user in every tenant. It is a route
 * segment, not a credential.
 *
 * @see https://learn.microsoft.com/en-us/graph/api/resources/passwordauthenticationmethod
 */
const PASSWORD_METHOD_ROUTE_SEGMENT = '28c10230-6103-485e-b985-444c60001490'

export const resetPasswordTool: ToolConfig<
  MicrosoftAdResetPasswordParams,
  MicrosoftAdResetPasswordResponse
> = {
  id: 'microsoft_ad_reset_password',
  name: 'Reset Microsoft Entra ID User Password',
  description:
    "Reset another user's password through their password authentication method. Leave the new password empty to have Microsoft generate one and return it. The user is prompted to change the password at their next sign-in. Cannot be run against your own account.",
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
      description: 'User ID or user principal name whose password should be reset',
    },
    newPassword: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'The new password. Required for tenants with hybrid password scenarios. Leave empty for a cloud-only password to have Microsoft generate and return one.',
    },
  },
  request: {
    url: (params) => {
      const userId = params.userId?.trim()
      if (!userId) throw new Error('User ID is required')
      return `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userId)}/authentication/methods/${PASSWORD_METHOD_ROUTE_SEGMENT}/resetPassword`
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const newPassword = params.newPassword?.trim()
      return newPassword ? { newPassword } : {}
    },
  },
  transformResponse: async (response: Response, params?: MicrosoftAdResetPasswordParams) => {
    const text = await response.text()
    let newPassword: string | null = null
    if (text) {
      try {
        newPassword = (JSON.parse(text).newPassword as string) ?? null
      } catch {
        newPassword = null
      }
    }
    return {
      success: true,
      output: {
        accepted: true,
        userId: params?.userId ?? '',
        newPassword,
        operationLocation: response.headers.get('Location'),
      },
    }
  },
  outputs: {
    accepted: {
      type: 'boolean',
      description: 'Whether Microsoft Graph accepted the password reset operation',
    },
    userId: { type: 'string', description: 'ID of the user whose password was reset' },
    newPassword: {
      type: 'string',
      description:
        'The system-generated password, returned only when no new password was supplied in the request. Like every tool output it appears in workflow outputs and run history, and is sent to the model when an agent calls this tool, so prefer supplying your own password when the value must not leave the workflow.',
      optional: true,
    },
    operationLocation: {
      type: 'string',
      description: 'URL to poll for the status of the long-running password reset operation',
      optional: true,
    },
  },
}
