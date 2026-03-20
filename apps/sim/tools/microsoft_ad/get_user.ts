import type {
  MicrosoftAdGetUserParams,
  MicrosoftAdGetUserResponse,
} from '@/tools/microsoft_ad/types'
import { USER_OUTPUT_PROPERTIES } from '@/tools/microsoft_ad/types'
import type { ToolConfig } from '@/tools/types'

export const getUserTool: ToolConfig<MicrosoftAdGetUserParams, MicrosoftAdGetUserResponse> = {
  id: 'microsoft_ad_get_user',
  name: 'Get Azure AD User',
  description: 'Get a user by ID or user principal name from Azure AD',
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
      description: 'User ID or user principal name (e.g., "user@example.com")',
    },
  },
  request: {
    url: (params) => {
      const userId = params.userId?.trim()
      if (!userId) throw new Error('User ID is required')
      return `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userId)}?$select=id,displayName,givenName,surname,userPrincipalName,mail,jobTitle,department,officeLocation,mobilePhone,accountEnabled`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },
  transformResponse: async (response: Response) => {
    const user = await response.json()
    return {
      success: true,
      output: {
        user: {
          id: user.id ?? null,
          displayName: user.displayName ?? null,
          givenName: user.givenName ?? null,
          surname: user.surname ?? null,
          userPrincipalName: user.userPrincipalName ?? null,
          mail: user.mail ?? null,
          jobTitle: user.jobTitle ?? null,
          department: user.department ?? null,
          officeLocation: user.officeLocation ?? null,
          mobilePhone: user.mobilePhone ?? null,
          accountEnabled: user.accountEnabled ?? null,
        },
      },
    }
  },
  outputs: {
    user: {
      type: 'object',
      description: 'User details',
      properties: USER_OUTPUT_PROPERTIES,
    },
  },
}
