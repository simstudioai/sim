import type {
  MicrosoftAdCreateUserParams,
  MicrosoftAdCreateUserResponse,
} from '@/tools/microsoft_ad/types'
import { USER_OUTPUT_PROPERTIES } from '@/tools/microsoft_ad/types'
import type { ToolConfig } from '@/tools/types'

export const createUserTool: ToolConfig<
  MicrosoftAdCreateUserParams,
  MicrosoftAdCreateUserResponse
> = {
  id: 'microsoft_ad_create_user',
  name: 'Create Azure AD User',
  description: 'Create a new user in Azure AD (Microsoft Entra ID)',
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
    displayName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Display name for the user',
    },
    mailNickname: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Mail alias for the user',
    },
    userPrincipalName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'User principal name (e.g., "user@example.com")',
    },
    password: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Initial password for the user',
    },
    accountEnabled: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description: 'Whether the account is enabled',
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
  },
  request: {
    url: 'https://graph.microsoft.com/v1.0/users',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        accountEnabled: params.accountEnabled,
        displayName: params.displayName,
        mailNickname: params.mailNickname,
        userPrincipalName: params.userPrincipalName,
        passwordProfile: {
          password: params.password,
          forceChangePasswordNextSignIn: true,
        },
      }
      if (params.givenName) body.givenName = params.givenName
      if (params.surname) body.surname = params.surname
      if (params.jobTitle) body.jobTitle = params.jobTitle
      if (params.department) body.department = params.department
      if (params.officeLocation) body.officeLocation = params.officeLocation
      if (params.mobilePhone) body.mobilePhone = params.mobilePhone
      return body
    },
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
      description: 'Created user details',
      properties: USER_OUTPUT_PROPERTIES,
    },
  },
}
