import type { FathomGetTranscriptParams, FathomGetTranscriptResponse } from '@/tools/fathom/types'
import type { ToolConfig } from '@/tools/types'

export const getTranscriptTool: ToolConfig<FathomGetTranscriptParams, FathomGetTranscriptResponse> =
  {
    id: 'fathom_get_transcript',
    name: 'Fathom Get Transcript',
    description: 'Get the full transcript for a specific meeting recording.',
    version: '1.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Fathom API Key',
      },
      recordingId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The recording ID of the meeting',
      },
    },

    request: {
      url: (params) =>
        `https://api.fathom.ai/external/v1/recordings/${encodeURIComponent(params.recordingId.trim())}/transcript`,
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
            transcript: [],
          },
        }
      }

      const data = await response.json()
      const transcript = (data.transcript ?? []).map(
        (entry: { speaker?: Record<string, unknown>; text?: string; timestamp?: string }) => ({
          speaker: {
            display_name: entry.speaker?.display_name ?? '',
            matched_calendar_invitee_email: entry.speaker?.matched_calendar_invitee_email ?? null,
          },
          text: entry.text ?? '',
          timestamp: entry.timestamp ?? '',
        })
      )

      return {
        success: true,
        output: {
          transcript,
        },
      }
    },

    outputs: {
      transcript: {
        type: 'array',
        description: 'Array of transcript entries with speaker, text, and timestamp',
        items: {
          type: 'object',
          properties: {
            speaker: {
              type: 'object',
              description: 'Speaker information',
              properties: {
                display_name: { type: 'string', description: 'Speaker display name' },
                matched_calendar_invitee_email: {
                  type: 'string',
                  description: 'Matched calendar invitee email',
                  optional: true,
                },
              },
            },
            text: { type: 'string', description: 'Transcript text' },
            timestamp: { type: 'string', description: 'Timestamp (HH:MM:SS)' },
          },
        },
      },
    },
  }
