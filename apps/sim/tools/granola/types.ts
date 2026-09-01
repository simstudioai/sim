import type { ToolResponse } from '@/tools/types'

export interface GranolaListNotesParams {
  apiKey: string
  createdBefore?: string
  createdAfter?: string
  updatedAfter?: string
  folderId?: string
  cursor?: string
  pageSize?: number
}

export interface GranolaGetNoteParams {
  apiKey: string
  noteId: string
  includeTranscript?: string
}

export interface GranolaListFoldersParams {
  apiKey: string
  cursor?: string
  pageSize?: number
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

export interface GranolaListFoldersResponse extends ToolResponse {
  output: {
    folders: {
      id: string
      name: string
      parentFolderId: string | null
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
    webUrl: string
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
    transcript:
      | {
          speaker: string
          speakerAttribution: string | null
          speakerLabel: string | null
          speakerName: string | null
          text: string
          startTime: string
          endTime: string
        }[]
      | null
  }
}

export interface GranolaGetTranscriptParams {
  apiKey: string
  noteId: string
  cursor?: string
  pageSize?: number
}

export interface GranolaListAuditEventsParams {
  apiKey: string
  action?: string
  occurredBefore?: string
  occurredAfter?: string
  cursor?: string
  pageSize?: number
}

export interface GranolaCreateWebhookEndpointParams {
  apiKey: string
  url: string
  scopes: string
  events?: string
  folderIds?: string
}

export interface GranolaListWebhookEndpointsParams {
  apiKey: string
}

export interface GranolaUpdateWebhookEndpointParams {
  apiKey: string
  webhookEndpointId: string
  url?: string
  scopes?: string
  events?: string
  folderIds?: string
  enabled?: boolean | string
}

export interface GranolaDeleteWebhookEndpointParams {
  apiKey: string
  webhookEndpointId: string
}

export interface GranolaGetTranscriptResponse extends ToolResponse {
  output: {
    transcript: {
      speaker: string
      speakerAttribution: string | null
      speakerLabel: string | null
      speakerName: string | null
      text: string
      startTime: string
      endTime: string
    }[]
    hasMore: boolean
    cursor: string | null
  }
}

export interface GranolaListAuditEventsResponse extends ToolResponse {
  output: {
    events: {
      id: string
      action: string
      occurredAt: string
      collectedAt: string
      actorType: string
      actorId: string | null
      actorEmail: string | null
      data: Record<string, unknown>
      ipAddress: string | null
      userAgent: string | null
      clientVersion: string | null
    }[]
    hasMore: boolean
    cursor: string | null
  }
}

/** The webhook endpoint shape shared by the create, list, and update tools. */
export interface GranolaWebhookEndpointOutput {
  id: string
  url: string
  urlRedacted: boolean
  events: string[]
  folderIds: string[]
  scopes: string[]
  createdByName: string | null
  createdByEmail: string | null
  enabled: boolean
  createdAt: string
}

export interface GranolaCreateWebhookEndpointResponse extends ToolResponse {
  output: GranolaWebhookEndpointOutput & { signingSecret: string }
}

export interface GranolaListWebhookEndpointsResponse extends ToolResponse {
  output: {
    webhookEndpoints: GranolaWebhookEndpointOutput[]
  }
}

export interface GranolaUpdateWebhookEndpointResponse extends ToolResponse {
  output: GranolaWebhookEndpointOutput
}

export interface GranolaDeleteWebhookEndpointResponse extends ToolResponse {
  output: {
    id: string
    deleted: boolean
  }
}
