import type { GranolaGetNoteParams, GranolaGetNoteResponse } from '@/tools/granola/types'
import { GRANOLA_API_BASE, granolaHeaders, throwGranolaError } from '@/tools/granola/utils'
import type { ToolConfig } from '@/tools/types'

export const getNoteTool: ToolConfig<GranolaGetNoteParams, GranolaGetNoteResponse> = {
  id: 'granola_get_note',
  name: 'Granola Get Note',
  description:
    'Retrieves a specific meeting note from Granola by ID, including summary, attendees, calendar event details, and optionally the transcript.',
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
    includeTranscript: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to include the meeting transcript',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`${GRANOLA_API_BASE}/notes/${encodeURIComponent(params.noteId.trim())}`)
      if (params.includeTranscript === 'true') url.searchParams.append('include', 'transcript')
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
        id: data.id ?? '',
        title: data.title ?? null,
        ownerName: data.owner?.name ?? null,
        ownerEmail: data.owner?.email ?? '',
        createdAt: data.created_at ?? '',
        updatedAt: data.updated_at ?? '',
        webUrl: data.web_url ?? '',
        summaryText: data.summary_text ?? '',
        summaryMarkdown: data.summary_markdown ?? null,
        attendees: (data.attendees ?? []).map((a: { name: string | null; email: string }) => ({
          name: a.name ?? null,
          email: a.email ?? '',
        })),
        folders: (data.folder_membership ?? []).map((f: { id: string; name: string }) => ({
          id: f.id ?? '',
          name: f.name ?? '',
        })),
        calendarEventTitle: data.calendar_event?.event_title ?? null,
        calendarOrganiser: data.calendar_event?.organiser ?? null,
        calendarEventId: data.calendar_event?.calendar_event_id ?? null,
        scheduledStartTime: data.calendar_event?.scheduled_start_time ?? null,
        scheduledEndTime: data.calendar_event?.scheduled_end_time ?? null,
        invitees: (data.calendar_event?.invitees ?? []).map((i: { email: string }) => i.email),
        transcript: data.transcript
          ? data.transcript.map(
              (t: {
                speaker: {
                  source: string
                  attribution?: string
                  diarization_label?: string
                  name?: string
                }
                text: string
                start_time: string
                end_time: string
              }) => ({
                speaker: t.speaker?.source ?? 'unknown',
                speakerAttribution: t.speaker?.attribution ?? null,
                speakerLabel: t.speaker?.diarization_label ?? null,
                speakerName: t.speaker?.name ?? null,
                text: t.text ?? '',
                startTime: t.start_time ?? '',
                endTime: t.end_time ?? '',
              })
            )
          : null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Note ID' },
    title: { type: 'string', description: 'Note title', optional: true },
    ownerName: { type: 'string', description: 'Note owner name', optional: true },
    ownerEmail: { type: 'string', description: 'Note owner email' },
    createdAt: { type: 'string', description: 'Creation timestamp' },
    updatedAt: { type: 'string', description: 'Last update timestamp' },
    webUrl: { type: 'string', description: 'URL to view the note in Granola' },
    summaryText: { type: 'string', description: 'Plain text summary of the meeting' },
    summaryMarkdown: {
      type: 'string',
      description: 'Markdown-formatted summary of the meeting',
      optional: true,
    },
    attendees: {
      type: 'array',
      description: 'Meeting attendees',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Attendee name' },
          email: { type: 'string', description: 'Attendee email' },
        },
      },
    },
    folders: {
      type: 'array',
      description: 'Folders the note belongs to',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Folder ID' },
          name: { type: 'string', description: 'Folder name' },
        },
      },
    },
    calendarEventTitle: {
      type: 'string',
      description: 'Calendar event title',
      optional: true,
    },
    calendarOrganiser: {
      type: 'string',
      description: 'Calendar event organiser email',
      optional: true,
    },
    calendarEventId: { type: 'string', description: 'Calendar event ID', optional: true },
    scheduledStartTime: {
      type: 'string',
      description: 'Scheduled start time',
      optional: true,
    },
    scheduledEndTime: { type: 'string', description: 'Scheduled end time', optional: true },
    invitees: {
      type: 'array',
      description: 'Calendar event invitee emails',
      items: { type: 'string' },
    },
    transcript: {
      type: 'array',
      description: 'Meeting transcript entries (only if requested)',
      optional: true,
      items: {
        type: 'object',
        properties: {
          speaker: { type: 'string', description: 'Speaker source (microphone or speaker)' },
          speakerAttribution: {
            type: 'string',
            description:
              'Who spoke relative to the note owner: "me" for the note-taker, "them" for other participants. Null when attribution is unknown.',
            optional: true,
          },
          speakerLabel: {
            type: 'string',
            description: 'Diarization label for the speaker (e.g., Speaker A)',
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
  },
}
