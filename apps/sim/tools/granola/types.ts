import type { ToolResponse } from '@/tools/types'

export interface GranolaListNotesParams {
  apiKey: string
  createdBefore?: string
  createdAfter?: string
  updatedAfter?: string
  cursor?: string
  pageSize?: number
}

export interface GranolaGetNoteParams {
  apiKey: string
  noteId: string
  includeTranscript?: string
}

export interface GranolaListNotesResponse extends ToolResponse {
  output: {
    notes: {
      id: string
      title: string | null
      ownerName: string | null
      ownerEmail: string
      createdAt: string
      updatedAt: string
    }[]
    hasMore: boolean
    cursor: string | null
  }
}

export interface GranolaGetNoteResponse extends ToolResponse {
  output: {
    id: string
    title: string | null
    ownerName: string | null
    ownerEmail: string
    createdAt: string
    updatedAt: string
    summaryText: string
    summaryMarkdown: string | null
    attendees: { name: string | null; email: string }[]
    folders: { id: string; name: string }[]
    calendarEventTitle: string | null
    calendarOrganiser: string | null
    calendarEventId: string | null
    scheduledStartTime: string | null
    scheduledEndTime: string | null
    invitees: string[]
    transcript: { speaker: string; text: string; startTime: string; endTime: string }[] | null
  }
}
