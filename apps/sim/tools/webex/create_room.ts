import type { ToolConfig } from '@/tools/types'
import type { WebexCreateRoomParams, WebexCreateRoomResponse } from '@/tools/webex/types'
import { ROOM_OUTPUT_PROPERTIES } from '@/tools/webex/types'

export const webexCreateRoomTool: ToolConfig<WebexCreateRoomParams, WebexCreateRoomResponse> = {
  id: 'webex_create_room',
  name: 'Webex Create Room',
  description: 'Create a new Webex room (space).',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'webex',
    requiredScopes: ['spark:rooms_write'],
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Webex API',
    },
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Room title (e.g., "Project Alpha")',
    },
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional team ID to create the room inside a team',
    },
  },

  request: {
    url: 'https://webexapis.com/v1/rooms',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, string> = { title: params.title }
      if (params.teamId) body.teamId = params.teamId
      return body
    },
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
      description: 'The created room object',
      properties: ROOM_OUTPUT_PROPERTIES,
    },
  },
}
