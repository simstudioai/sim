import type {
  FathomListMeetingTypesParams,
  FathomListMeetingTypesResponse,
} from '@/tools/fathom/types'
import type { ToolConfig } from '@/tools/types'

export const listMeetingTypesTool: ToolConfig<
  FathomListMeetingTypesParams,
  FathomListMeetingTypesResponse
> = {
  id: 'fathom_list_meeting_types',
  name: 'Fathom List Meeting Types',
  description: 'List meeting types configured in your Fathom organization.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Fathom API Key',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from a previous response',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.fathom.ai/external/v1/meeting_types')
      if (params.cursor) url.searchParams.append('cursor', params.cursor)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      'X-Api-Key': params.apiKey,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return {
        success: false,
        error:
          (errorData as Record<string, string>).message ||
          `Fathom API error: ${response.status} ${response.statusText}`,
        output: {
          meetingTypes: [],
          next_cursor: null,
        },
      }
    }

    const data = await response.json()
    const meetingTypes = (data.items ?? []).map(
      (meetingType: { name?: string; status?: string; created_at?: string }) => ({
        name: meetingType.name ?? '',
        status: meetingType.status ?? '',
        created_at: meetingType.created_at ?? '',
      })
    )

    return {
      success: true,
      output: {
        meetingTypes,
        next_cursor: data.next_cursor ?? null,
      },
    }
  },

  outputs: {
    meetingTypes: {
      type: 'array',
      description: 'List of meeting types',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Meeting type name' },
          status: { type: 'string', description: 'Meeting type status: active or inactive' },
          created_at: { type: 'string', description: 'Date the meeting type was created' },
        },
      },
    },
    next_cursor: {
      type: 'string',
      description: 'Pagination cursor for next page',
      optional: true,
    },
  },
}
