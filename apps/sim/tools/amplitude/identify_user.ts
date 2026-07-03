import type {
  AmplitudeIdentifyUserParams,
  AmplitudeIdentifyUserResponse,
} from '@/tools/amplitude/types'
import { getIngestionHost } from '@/tools/amplitude/utils'
import type { ToolConfig } from '@/tools/types'

export const identifyUserTool: ToolConfig<
  AmplitudeIdentifyUserParams,
  AmplitudeIdentifyUserResponse
> = {
  id: 'amplitude_identify_user',
  name: 'Amplitude Identify User',
  description:
    'Set user properties in Amplitude using the Identify API. Supports $set, $setOnce, $add, $append, $unset operations.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Amplitude API Key',
    },
    userId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'User ID (required if no device_id)',
    },
    deviceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Device ID (required if no user_id)',
    },
    userProperties: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON object of user properties. Use operations like $set, $setOnce, $add, $append, $unset.',
    },
    dataResidency: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Data residency region: "us" (default) or "eu"',
    },
  },

  request: {
    url: (params) => `${getIngestionHost(params.dataResidency)}/identify`,
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/x-www-form-urlencoded',
    }),
    body: (params) => {
      const identification: Record<string, unknown> = {}

      if (params.userId) identification.user_id = params.userId
      if (params.deviceId) identification.device_id = params.deviceId

      try {
        identification.user_properties = JSON.parse(params.userProperties)
      } catch {
        identification.user_properties = {}
      }

      const body = new URLSearchParams({
        api_key: params.apiKey,
        identification: JSON.stringify([identification]),
      })

      return body.toString()
    },
  },

  transformResponse: async (response: Response) => {
    const text = await response.text()

    if (!response.ok) {
      throw new Error(`Amplitude Identify API error: ${text}`)
    }

    return {
      success: true,
      output: {
        code: response.status,
        message: text || null,
      },
    }
  },

  outputs: {
    code: {
      type: 'number',
      description: 'HTTP response status code',
    },
    message: {
      type: 'string',
      description: 'Response message',
      optional: true,
    },
  },
}
