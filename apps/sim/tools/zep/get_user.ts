import type { ToolConfig } from '@/tools/types'
import type { ZepResponse } from '@/tools/zep/types'

// Get User Tool - Retrieve user information (Zep v3)
export const zepGetUserTool: ToolConfig<any, ZepResponse> = {
  id: 'zep_get_user',
  name: 'Get User',
  description: 'Retrieve user information from Zep',
  version: '1.0.0',

  params: {
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'User ID to retrieve',
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
    const text = await response.text()

    if (!response.ok) {
      throw new Error(`Zep API error (${response.status}): ${text || response.statusText}`)
    }

    const data = JSON.parse(text.replace(/^\uFEFF/, '').trim())

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
    userId: {
      type: 'string',
      description: 'The user ID',
    },
    email: {
      type: 'string',
      description: 'User email',
    },
    firstName: {
      type: 'string',
      description: 'User first name',
    },
    lastName: {
      type: 'string',
      description: 'User last name',
    },
    uuid: {
      type: 'string',
      description: 'Internal UUID',
    },
    createdAt: {
      type: 'string',
      description: 'Creation timestamp',
    },
    updatedAt: {
      type: 'string',
      description: 'Last update timestamp',
    },
    metadata: {
      type: 'object',
      description: 'User metadata',
    },
  },
}
