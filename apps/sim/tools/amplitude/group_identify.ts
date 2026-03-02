import type {
  AmplitudeGroupIdentifyParams,
  AmplitudeGroupIdentifyResponse,
} from '@/tools/amplitude/types'
import type { ToolConfig } from '@/tools/types'

export const groupIdentifyTool: ToolConfig<
  AmplitudeGroupIdentifyParams,
  AmplitudeGroupIdentifyResponse
> = {
  id: 'amplitude_group_identify',
  name: 'Amplitude Group Identify',
  description:
    'Set group-level properties in Amplitude. Supports $set, $setOnce, $add, $append, $unset operations.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Amplitude API Key',
    },
    groupType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Group classification (e.g., "company", "org_id")',
    },
    groupValue: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Specific group identifier (e.g., "Acme Corp")',
    },
    groupProperties: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON object of group properties. Use operations like $set, $setOnce, $add, $append, $unset.',
    },
  },

  request: {
    url: 'https://api2.amplitude.com/groupidentify',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      let groupProperties: Record<string, unknown> = {}
      try {
        groupProperties = JSON.parse(params.groupProperties)
      } catch {
        groupProperties = {}
      }

      return {
        api_key: params.apiKey,
        identification: [
          {
            group_type: params.groupType,
            group_value: params.groupValue,
            group_properties: groupProperties,
          },
        ],
      }
    },
  },

  transformResponse: async (response: Response) => {
    const text = await response.text()

    if (!response.ok) {
      throw new Error(`Amplitude Group Identify API error: ${text}`)
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
