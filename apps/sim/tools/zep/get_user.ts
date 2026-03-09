import type { ToolConfig } from '@/tools/types'
import type { ZepResponse } from '@/tools/zep/types'
import { USER_OUTPUT_PROPERTIES } from '@/tools/zep/types'

export const zepGetUserTool: ToolConfig<any, ZepResponse> = {
  id: 'zep_get_user',
  name: 'Get User',
  description: 'Retrieve user information from Zep',
  version: '1.0.0',

  params: {
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'User ID to retrieve (e.g., "user_123")',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Zep API key',
    },
  },

  request: {
    url: (params) => `https://api.getzep.com/api/v2/users/${params.userId}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Api-Key ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Zep API error (${response.status}): ${error || response.statusText}`)
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        userId: data.user_id,
        email: data.email,
        firstName: data.first_name,
        lastName: data.last_name,
        uuid: data.uuid,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        metadata: data.metadata,
      },
    }
  },

  outputs: {
    userId: USER_OUTPUT_PROPERTIES.userId,
    email: USER_OUTPUT_PROPERTIES.email,
    firstName: USER_OUTPUT_PROPERTIES.firstName,
    lastName: USER_OUTPUT_PROPERTIES.lastName,
    uuid: USER_OUTPUT_PROPERTIES.uuid,
    createdAt: USER_OUTPUT_PROPERTIES.createdAt,
    updatedAt: USER_OUTPUT_PROPERTIES.updatedAt,
    metadata: USER_OUTPUT_PROPERTIES.metadata,
  },
}
