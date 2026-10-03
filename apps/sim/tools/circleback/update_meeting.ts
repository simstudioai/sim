import type { CirclebackUpdateMeetingParams } from '@/tools/circleback/types'
import {
  CIRCLEBACK_API_BASE,
  circlebackHeaders,
  throwCirclebackError,
} from '@/tools/circleback/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

interface CirclebackUpdateMeetingResponse extends ToolResponse {
  output: {
    id: string | null
    name: string | null
    notes: string | null
    privateNotes: string | null
    updatedAt: string | null
  }
}

export const updateMeetingTool: ToolConfig<
  CirclebackUpdateMeetingParams,
  CirclebackUpdateMeetingResponse
> = {
  id: 'circleback_update_meeting',
  name: 'Circleback Update Meeting',
  description:
    'Updates the name, notes, or private notes of a Circleback meeting. The API returns only the fields that were updated.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Circleback API key',
    },
    meetingId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique identifier of the meeting',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The new name of the meeting',
    },
    notes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The new meeting notes in Markdown',
    },
    privateNotes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The authenticated user private notes for the meeting',
    },
  },

  request: {
    url: (params) =>
      `${CIRCLEBACK_API_BASE}/meeting/${safeUrlPathSegment(params.meetingId, 'meetingId')}`,
    method: 'PUT',
    headers: (params) => circlebackHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, string> = {}
      if (params.name !== undefined && params.name !== '') body.name = params.name
      if (params.notes !== undefined && params.notes !== '') body.notes = params.notes
      if (params.privateNotes !== undefined && params.privateNotes !== '') {
        body.privateNotes = params.privateNotes
      }
      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) await throwCirclebackError(response)

    const data = await response.json()

    return {
      success: true,
      output: {
        id: data.id ?? null,
        name: data.name ?? null,
        notes: data.notes ?? null,
        privateNotes: data.privateNotes ?? null,
        updatedAt: data.updatedAt ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'The Circleback meeting ID', optional: true },
    name: {
      type: 'string',
      nullable: true,
      optional: true,
      description: 'The updated meeting name, when the name was updated',
    },
    notes: {
      type: 'string',
      nullable: true,
      optional: true,
      description: 'The updated meeting notes, when the notes were updated',
    },
    privateNotes: {
      type: 'string',
      nullable: true,
      optional: true,
      description: 'The updated private notes, when the private notes were updated',
    },
    updatedAt: {
      type: 'string',
      optional: true,
      description: 'When the meeting was last updated (ISO 8601)',
    },
  },
}
