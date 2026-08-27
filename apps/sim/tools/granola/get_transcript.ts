import type {
  GranolaGetTranscriptParams,
  GranolaGetTranscriptResponse,
} from '@/tools/granola/types'
import { GRANOLA_API_BASE, granolaHeaders, throwGranolaError } from '@/tools/granola/utils'
import type { ToolConfig } from '@/tools/types'

export const getTranscriptTool: ToolConfig<
  GranolaGetTranscriptParams,
  GranolaGetTranscriptResponse
> = {
  id: 'granola_get_transcript',
  name: 'Granola Get Transcript',
  description:
    'Retrieves a meeting transcript from Granola one page at a time, including when Get Note reports the transcript is too large to return inline.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Granola API key',
    },
    noteId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The note ID (e.g., not_1d3tmYTlCICgjy)',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from a previous response',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of transcript items per page (1-100, default 50)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `${GRANOLA_API_BASE}/notes/${encodeURIComponent(params.noteId.trim())}/transcript`
      )
      if (params.cursor) url.searchParams.append('cursor', params.cursor)
      if (params.pageSize) url.searchParams.append('page_size', String(params.pageSize))
      return url.toString()
    },
    method: 'GET',
    headers: (params) => granolaHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) await throwGranolaError(response)

    const data = await response.json()

    return {
      success: true,
      output: {
        transcript: (data.transcript ?? []).map(
          (item: {
            speaker?: {
              source?: string
              attribution?: string
              diarization_label?: string
              name?: string
            }
            text?: string
            start_time?: string
            end_time?: string
          }) => ({
            speaker: item.speaker?.source ?? '',
            speakerAttribution: item.speaker?.attribution ?? null,
            speakerLabel: item.speaker?.diarization_label ?? null,
            speakerName: item.speaker?.name ?? null,
            text: item.text ?? '',
            startTime: item.start_time ?? '',
            endTime: item.end_time ?? '',
          })
        ),
        hasMore: data.hasMore ?? false,
        cursor: data.cursor ?? null,
      },
    }
  },

  outputs: {
    transcript: {
      type: 'array',
      description: 'Transcript items for this page',
      items: {
        type: 'object',
        properties: {
          speaker: {
            type: 'string',
            description: 'Audio source of the speaker (microphone or speaker)',
          },
          speakerAttribution: {
            type: 'string',
            description:
              'Who spoke relative to the note owner: "me" for the note-taker, "them" for other participants. Null when attribution is unknown.',
            optional: true,
          },
          speakerLabel: {
            type: 'string',
            description: 'Anonymous diarization label for the speaker (e.g., Speaker A)',
            optional: true,
          },
          speakerName: {
            type: 'string',
            description: 'Resolved name of the identified speaker, when available',
            optional: true,
          },
          text: { type: 'string', description: 'Transcript text' },
          startTime: { type: 'string', description: 'Segment start time' },
          endTime: { type: 'string', description: 'Segment end time' },
        },
      },
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether another page of transcript items is available',
    },
    cursor: {
      type: 'string',
      description: 'Pagination cursor for the next page',
      optional: true,
    },
  },
}
