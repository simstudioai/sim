import type {
  MicrosoftAdListAuthenticationMethodsParams,
  MicrosoftAdListAuthenticationMethodsResponse,
} from '@/tools/microsoft_ad/types'
import { AUTHENTICATION_METHOD_OUTPUT_PROPERTIES } from '@/tools/microsoft_ad/types'
import type { ToolConfig } from '@/tools/types'

export const listAuthenticationMethodsTool: ToolConfig<
  MicrosoftAdListAuthenticationMethodsParams,
  MicrosoftAdListAuthenticationMethodsResponse
> = {
  id: 'microsoft_ad_list_authentication_methods',
  name: 'List Microsoft Entra ID Authentication Methods',
  description:
    'List the authentication methods a user has registered, such as passwords, phone numbers, FIDO2 keys, and authenticator apps',
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
      return `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userId)}/authentication/methods`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },
  transformResponse: async (response: Response) => {
    const data = await response.json()
    const methods = (data.value ?? []).map((method: Record<string, unknown>) => ({
      id: method.id ?? null,
      odataType: (method['@odata.type'] as string) ?? null,
      createdDateTime: method.createdDateTime ?? null,
    }))
    return {
      success: true,
      output: {
        methods,
        methodCount: methods.length,
      },
    }
  },
  outputs: {
    methods: {
      type: 'array',
      description: 'Authentication methods registered by the user',
      items: {
        type: 'object',
        properties: AUTHENTICATION_METHOD_OUTPUT_PROPERTIES,
      },
    },
    methodCount: { type: 'number', description: 'Number of authentication methods returned' },
  },
}
