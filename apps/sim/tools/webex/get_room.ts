import type { ToolConfig } from '@/tools/types'
import type { WebexGetRoomParams, WebexGetRoomResponse } from '@/tools/webex/types'
import { ROOM_OUTPUT_PROPERTIES } from '@/tools/webex/types'

export const webexGetRoomTool: ToolConfig<WebexGetRoomParams, WebexGetRoomResponse> = {
  id: 'webex_get_room',
  name: 'Webex Get Room',
  description: 'Get details of a specific Webex room by its ID.',
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
    roomId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The room ID to retrieve',
    },
  },

  request: {
    url: (params) => `https://webexapis.com/v1/rooms/${encodeURIComponent(params.roomId)}`,
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
        output: { room: {} },
      }
    }
    const data = await response.json()
    return { success: true, output: { room: data } }
  },

  outputs: {
    room: {
      type: 'object',
      description: 'The room object',
      properties: ROOM_OUTPUT_PROPERTIES,
    },
  },
}
