import type {
  MicrosoftAdUpdateUserParams,
  MicrosoftAdUpdateUserResponse,
} from '@/tools/microsoft_ad/types'
import type { ToolConfig } from '@/tools/types'

export const updateUserTool: ToolConfig<
  MicrosoftAdUpdateUserParams,
  MicrosoftAdUpdateUserResponse
> = {
  id: 'microsoft_ad_update_user',
  name: 'Update Azure AD User',
  description: 'Update user properties in Azure AD (Microsoft Entra ID)',
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
    displayName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Display name',
    },
    givenName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'First name',
    },
    surname: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Last name',
    },
    jobTitle: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Job title',
    },
    department: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Department',
    },
    officeLocation: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Office location',
    },
    mobilePhone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Mobile phone number',
    },
    accountEnabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the account is enabled',
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
      const body: Record<string, unknown> = {}
      if (params.displayName) body.displayName = params.displayName
      if (params.givenName) body.givenName = params.givenName
      if (params.surname) body.surname = params.surname
      if (params.jobTitle) body.jobTitle = params.jobTitle
      if (params.department) body.department = params.department
      if (params.officeLocation) body.officeLocation = params.officeLocation
      if (params.mobilePhone) body.mobilePhone = params.mobilePhone
      if (params.accountEnabled !== undefined) body.accountEnabled = params.accountEnabled
      return body
    },
  },
  transformResponse: async (_response: Response, params?: MicrosoftAdUpdateUserParams) => {
    return {
      success: true,
      output: {
        updated: true,
        userId: params?.userId ?? '',
      },
    }
  },
  outputs: {
    updated: { type: 'boolean', description: 'Whether the update was successful' },
    userId: { type: 'string', description: 'ID of the updated user' },
  },
}
