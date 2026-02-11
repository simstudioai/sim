import type { ToolConfig } from '@/tools/types'
import type { ZepResponse } from '@/tools/zep/types'
import { USER_OUTPUT_PROPERTIES } from '@/tools/zep/types'

export const zepAddUserTool: ToolConfig<any, ZepResponse> = {
  id: 'zep_add_user',
  name: 'Add User',
  description: 'Create a new user in Zep',
  version: '1.0.0',

  params: {
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique identifier for the user (e.g., "user_123")',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'User email address',
    },
    firstName: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'User first name',
    },
    lastName: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'User last name',
    },
    metadata: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Additional metadata as JSON object (e.g., {"key": "value"})',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Zep API key',
    },
  },

  request: {
    url: 'https://api.getzep.com/api/v2/users',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Api-Key ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, any> = {
        user_id: params.userId,
      }

      if (params.email) body.email = params.email
      if (params.firstName) body.first_name = params.firstName
      if (params.lastName) body.last_name = params.lastName

      if (params.metadata) {
        let metadataObj = params.metadata
        if (typeof metadataObj === 'string') {
          try {
            metadataObj = JSON.parse(metadataObj)
          } catch (_e) {
            throw new Error('Metadata must be a valid JSON object')
          }
        }
        body.metadata = metadataObj
      }

      return body
    },
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Zep API error (${response.status}): ${error || response.statusText}`)
    }

    const text = await response.text()
    if (!text || text.trim() === '') {
      return {
        success: true,
        output: {},
      }
    }

    const data = JSON.parse(text)

    return {
      success: true,
      output: {
        userId: data.user_id,
        email: data.email,
        firstName: data.first_name,
        lastName: data.last_name,
        uuid: data.uuid,
        createdAt: data.created_at,
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
    metadata: USER_OUTPUT_PROPERTIES.metadata,
  },
}
