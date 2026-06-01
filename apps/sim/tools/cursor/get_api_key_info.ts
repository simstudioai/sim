import type { GetApiKeyInfoParams, GetApiKeyInfoResponse } from '@/tools/cursor/types'
import type { ToolConfig } from '@/tools/types'

const getApiKeyInfoBase = {
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Cursor API key',
    },
  },
  request: {
    url: () => 'https://api.cursor.com/v0/me',
    method: 'GET',
    headers: (params: GetApiKeyInfoParams) => ({
      Authorization: `Basic ${Buffer.from(`${params.apiKey}:`).toString('base64')}`,
    }),
  },
} satisfies Pick<ToolConfig<GetApiKeyInfoParams, any>, 'params' | 'request'>

export const getApiKeyInfoTool: ToolConfig<GetApiKeyInfoParams, GetApiKeyInfoResponse> = {
  id: 'cursor_get_api_key_info',
  name: 'Cursor Get API Key Info',
  description: 'Retrieve details about the API key currently in use.',
  version: '1.0.0',

  ...getApiKeyInfoBase,

  transformResponse: async (response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        content: `API key "${data.apiKeyName}" for ${data.userEmail}`,
        metadata: {
          apiKeyName: data.apiKeyName,
          createdAt: data.createdAt,
          userEmail: data.userEmail,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable API key summary' },
    metadata: {
      type: 'object',
      description: 'API key metadata',
      properties: {
        apiKeyName: { type: 'string', description: 'Name of the API key' },
        createdAt: { type: 'string', description: 'API key creation timestamp' },
        userEmail: { type: 'string', description: 'Email of the key owner' },
      },
    },
  },
}

interface GetApiKeyInfoV2Response {
  success: boolean
  output: {
    apiKeyName: string
    createdAt: string
    userEmail: string
  }
}

export const getApiKeyInfoV2Tool: ToolConfig<GetApiKeyInfoParams, GetApiKeyInfoV2Response> = {
  ...getApiKeyInfoBase,
  id: 'cursor_get_api_key_info_v2',
  name: 'Cursor Get API Key Info',
  description:
    'Retrieve details about the API key currently in use. Returns API-aligned fields only.',
  version: '2.0.0',
  transformResponse: async (response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        apiKeyName: data.apiKeyName,
        createdAt: data.createdAt,
        userEmail: data.userEmail,
      },
    }
  },
  outputs: {
    apiKeyName: { type: 'string', description: 'Name of the API key' },
    createdAt: { type: 'string', description: 'API key creation timestamp' },
    userEmail: { type: 'string', description: 'Email of the key owner' },
  },
}
