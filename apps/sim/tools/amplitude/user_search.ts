import type {
  AmplitudeUserSearchParams,
  AmplitudeUserSearchResponse,
} from '@/tools/amplitude/types'
import type { ToolConfig } from '@/tools/types'

export const userSearchTool: ToolConfig<AmplitudeUserSearchParams, AmplitudeUserSearchResponse> = {
  id: 'amplitude_user_search',
  name: 'Amplitude User Search',
  description:
    'Search for a user by User ID, Device ID, or Amplitude ID using the Dashboard REST API.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Amplitude API Key',
    },
    secretKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Amplitude Secret Key',
    },
    user: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'User ID, Device ID, or Amplitude ID to search for',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://amplitude.com/api/2/usersearch')
      url.searchParams.set('user', params.user.trim())
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Basic ${btoa(`${params.apiKey}:${params.secretKey}`)}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || `Amplitude User Search API error: ${response.status}`)
    }

    const matches = (data.matches ?? []).map(
      (m: Record<string, unknown>) =>
        ({
          amplitudeId: (m.amplitude_id as number) ?? 0,
          userId: (m.user_id as string) ?? null,
        }) as const
    )

    return {
      success: true,
      output: {
        matches,
        type: (data.type as string) ?? null,
      },
    }
  },

  outputs: {
    matches: {
      type: 'array',
      description: 'List of matching users',
      items: {
        type: 'object',
        properties: {
          amplitudeId: { type: 'number', description: 'Amplitude internal user ID' },
          userId: { type: 'string', description: 'External user ID' },
        },
      },
    },
    type: {
      type: 'string',
      description: 'Match type (e.g., match_user_or_device_id)',
      optional: true,
    },
  },
}
