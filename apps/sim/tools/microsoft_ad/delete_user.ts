import type {
  MicrosoftAdDeleteUserParams,
  MicrosoftAdDeleteUserResponse,
} from '@/tools/microsoft_ad/types'
import type { ToolConfig } from '@/tools/types'

export const deleteUserTool: ToolConfig<
  MicrosoftAdDeleteUserParams,
  MicrosoftAdDeleteUserResponse
> = {
  id: 'microsoft_ad_delete_user',
  name: 'Delete Azure AD User',
  description:
    'Delete a user from Azure AD (Microsoft Entra ID). The user is moved to a temporary container and can be restored within 30 days.',
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
      description: 'User ID or user principal name',
    },
  },
  request: {
    url: (params) => {
      const userId = params.userId?.trim()
      if (!userId) throw new Error('User ID is required')
      return `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userId)}`
    },
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },
  transformResponse: async (_response: Response, params?: MicrosoftAdDeleteUserParams) => {
    return {
      success: true,
      output: {
        deleted: true,
        userId: params?.userId ?? '',
      },
    }
  },
  outputs: {
    deleted: { type: 'boolean', description: 'Whether the deletion was successful' },
    userId: { type: 'string', description: 'ID of the deleted user' },
  },
}
