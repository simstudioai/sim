import type { ToolConfig } from '@/tools/types'
import type { WebexListRoomsParams, WebexListRoomsResponse } from '@/tools/webex/types'
import { ROOMS_LIST_OUTPUT } from '@/tools/webex/types'

export const webexListRoomsTool: ToolConfig<WebexListRoomsParams, WebexListRoomsResponse> = {
  id: 'webex_list_rooms',
  name: 'Webex List Rooms',
  description: 'List Webex rooms (spaces) that the authenticated user is a member of.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'webex',
    requiredScopes: ['spark:rooms_read'],
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Webex API',
    },
    max: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of rooms to return (1-1000)',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Room type filter: direct or group',
    },
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort by: id, lastactivity (default), created',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.max) query.set('max', String(params.max))
      if (params.type) query.set('type', params.type)
      if (params.sortBy) query.set('sortBy', params.sortBy)
      const qs = query.toString()
      return `https://webexapis.com/v1/rooms${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return {
        success: false,
        error:
          (errorData as { message?: string }).message ||
          `Webex API error: ${response.status} ${response.statusText}`,
        output: { rooms: [] },
      }
    }
    const data = await response.json()
    return { success: true, output: { rooms: data.items ?? [] } }
  },

  outputs: { rooms: ROOMS_LIST_OUTPUT },
}
