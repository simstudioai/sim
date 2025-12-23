import type {
  GrainListMeetingTypesParams,
  GrainListMeetingTypesResponse,
} from '@/tools/grain/types'
import type { ToolConfig } from '@/tools/types'

export const grainListMeetingTypesTool: ToolConfig<
  GrainListMeetingTypesParams,
  GrainListMeetingTypesResponse
> = {
  id: 'grain_list_meeting_types',
  name: 'Grain List Meeting Types',
  description: 'List all meeting types in the workspace',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Grain API key (Personal Access Token)',
    },
  },

  request: {
    url: 'https://api.grain.com/_/public-api/v2/meeting_types',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
      'Public-Api-Version': '2025-10-31',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || data.message || 'Failed to list meeting types')
    }

    return {
      success: true,
      output: {
        meeting_types: data.meeting_types || data || [],
      },
    }
  },

  outputs: {
    meeting_types: {
      type: 'array',
      description: 'Array of meeting type objects',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Meeting type UUID' },
          name: { type: 'string', description: 'Meeting type name' },
          scope: { type: 'string', description: 'internal or external' },
        },
      },
    },
  },
}
