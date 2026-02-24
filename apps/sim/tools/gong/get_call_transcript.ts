import type { GongGetCallTranscriptParams, GongGetCallTranscriptResponse } from '@/tools/gong/types'
import type { ToolConfig } from '@/tools/types'

export const getCallTranscriptTool: ToolConfig<
  GongGetCallTranscriptParams,
  GongGetCallTranscriptResponse
> = {
  id: 'gong_get_call_transcript',
  name: 'Gong Get Call Transcript',
  description: 'Retrieve transcripts of calls from Gong by call IDs or date range.',
  version: '1.0.0',

  params: {
    accessKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Gong API Access Key',
    },
    accessKeySecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Gong API Access Key Secret',
    },
    callIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of call IDs to retrieve transcripts for',
    },
    fromDateTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start date/time filter in ISO-8601 format',
    },
    toDateTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'End date/time filter in ISO-8601 format',
    },
    workspaceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Gong workspace ID to filter calls',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from a previous response',
    },
  },

  request: {
    url: 'https://api.gong.io/v2/calls/transcript',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.accessKey}:${params.accessKeySecret}`)}`,
    }),
    body: (params) => {
      const filter: Record<string, unknown> = {}
      if (params.callIds) {
        filter.callIds = params.callIds.split(',').map((id) => id.trim())
      }
      if (params.fromDateTime) filter.fromDateTime = params.fromDateTime
      if (params.toDateTime) filter.toDateTime = params.toDateTime
      if (params.workspaceId) filter.workspaceId = params.workspaceId
      const body: Record<string, unknown> = { filter }
      if (params.cursor) body.cursor = params.cursor
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.errors?.[0]?.message || data.message || 'Failed to get call transcript')
    }
    const callTranscripts = (data.callTranscripts ?? []).map((ct: Record<string, unknown>) => ({
      callId: ct.callId ?? '',
      transcript: ((ct.transcript as Record<string, unknown>[]) ?? []).map((t) => ({
        speakerId: t.speakerId ?? null,
        topic: t.topic ?? null,
        sentences: ((t.sentences as Record<string, unknown>[]) ?? []).map((s) => ({
          start: s.start ?? 0,
          end: s.end ?? 0,
          text: s.text ?? '',
        })),
      })),
    }))
    return {
      success: true,
      output: {
        callTranscripts,
        cursor: data.records?.cursor ?? null,
      },
    }
  },

  outputs: {
    callTranscripts: {
      type: 'array',
      description: 'List of call transcripts with speaker turns and sentences',
      items: {
        type: 'object',
        properties: {
          callId: { type: 'string', description: "Gong's unique numeric identifier for the call" },
          transcript: {
            type: 'array',
            description: 'List of monologues in the call',
            items: {
              type: 'object',
              properties: {
                speakerId: {
                  type: 'string',
                  description: 'Unique ID of the speaker, cross-reference with parties',
                },
                topic: { type: 'string', description: 'Name of the topic being discussed' },
                sentences: {
                  type: 'array',
                  description: 'List of sentences spoken in the monologue',
                  items: {
                    type: 'object',
                    properties: {
                      start: {
                        type: 'number',
                        description: 'Start time of the sentence in milliseconds from call start',
                      },
                      end: {
                        type: 'number',
                        description: 'End time of the sentence in milliseconds from call start',
                      },
                      text: { type: 'string', description: 'The sentence text' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    cursor: {
      type: 'string',
      description: 'Pagination cursor for the next page',
      optional: true,
    },
  },
}
