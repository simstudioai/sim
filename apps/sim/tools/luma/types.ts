import type { ToolResponse } from '@/tools/types'

export interface LumaGetEventParams {
  apiKey: string
  eventId: string
}

export interface LumaCreateEventParams {
  apiKey: string
  name: string
  startAt: string
  timezone: string
  durationInterval?: string
  endAt?: string
  descriptionMd?: string
  meetingUrl?: string
  visibility?: string
  coverUrl?: string
}

export interface LumaListEventsParams {
  apiKey: string
  after?: string
  before?: string
  paginationLimit?: number
  paginationCursor?: string
  sortColumn?: string
  sortDirection?: string
}

export interface LumaGetGuestsParams {
  apiKey: string
  eventId: string
  approvalStatus?: string
  paginationLimit?: number
  paginationCursor?: string
  sortColumn?: string
  sortDirection?: string
}

export interface LumaUpdateEventParams {
  apiKey: string
  eventId: string
  name?: string
  startAt?: string
  timezone?: string
  endAt?: string
  durationInterval?: string
  descriptionMd?: string
  meetingUrl?: string
  visibility?: string
  coverUrl?: string
}

export interface LumaAddGuestsParams {
  apiKey: string
  eventId: string
  guests: string
}

export interface LumaHostEntry {
  name: string | null
  email: string | null
}

export interface LumaEventEntry {
  id: string
  name: string
  startAt: string | null
  endAt: string | null
  timezone: string | null
  durationInterval: string | null
  createdAt: string | null
  description: string | null
  descriptionMd: string | null
  coverUrl: string | null
  url: string | null
  visibility: string | null
  meetingUrl: string | null
  geoAddressJson: Record<string, unknown> | null
  geoLatitude: string | null
  geoLongitude: string | null
  calendarId: string | null
}

export interface LumaGuestEntry {
  id: string
  email: string | null
  name: string | null
  firstName: string | null
  lastName: string | null
  approvalStatus: string | null
  registeredAt: string | null
  invitedAt: string | null
  joinedAt: string | null
  checkedInAt: string | null
  phoneNumber: string | null
}

export interface LumaGetEventResponse extends ToolResponse {
  output: {
    event: LumaEventEntry
    hosts: LumaHostEntry[]
  }
}

export interface LumaCreateEventResponse extends ToolResponse {
  output: {
    event: LumaEventEntry
    hosts: LumaHostEntry[]
  }
}

export interface LumaUpdateEventResponse extends ToolResponse {
  output: {
    event: LumaEventEntry
    hosts: LumaHostEntry[]
  }
}

export interface LumaListEventsResponse extends ToolResponse {
  output: {
    events: LumaEventEntry[]
    hasMore: boolean
    nextCursor: string | null
  }
}

export interface LumaGetGuestsResponse extends ToolResponse {
  output: {
    guests: LumaGuestEntry[]
    hasMore: boolean
    nextCursor: string | null
  }
}

export interface LumaAddGuestsResponse extends ToolResponse {
  output: {
    guests: LumaGuestEntry[]
  }
}

export const LUMA_HOST_OUTPUT_PROPERTIES = {
  name: { type: 'string' as const, description: 'Host name' },
  email: { type: 'string' as const, description: 'Host email address' },
}

export const LUMA_EVENT_OUTPUT_PROPERTIES = {
  id: { type: 'string' as const, description: 'Event ID' },
  name: { type: 'string' as const, description: 'Event name' },
  startAt: { type: 'string' as const, description: 'Event start time (ISO 8601)' },
  endAt: { type: 'string' as const, description: 'Event end time (ISO 8601)' },
  timezone: { type: 'string' as const, description: 'Event timezone (IANA)' },
  durationInterval: {
    type: 'string' as const,
    description: 'Event duration (ISO 8601 interval, e.g. PT2H)',
  },
  createdAt: { type: 'string' as const, description: 'Event creation timestamp (ISO 8601)' },
  description: { type: 'string' as const, description: 'Event description (plain text)' },
  descriptionMd: { type: 'string' as const, description: 'Event description (Markdown)' },
  coverUrl: { type: 'string' as const, description: 'Event cover image URL' },
  url: { type: 'string' as const, description: 'Event page URL on lu.ma' },
  visibility: {
    type: 'string' as const,
    description: 'Event visibility (public, members-only, private)',
  },
  meetingUrl: { type: 'string' as const, description: 'Virtual meeting URL' },
  geoAddressJson: { type: 'json' as const, description: 'Structured location/address data' },
  geoLatitude: { type: 'string' as const, description: 'Venue latitude coordinate' },
  geoLongitude: { type: 'string' as const, description: 'Venue longitude coordinate' },
  calendarId: { type: 'string' as const, description: 'Associated calendar ID' },
}

export const LUMA_GUEST_OUTPUT_PROPERTIES = {
  id: { type: 'string' as const, description: 'Guest ID' },
  email: { type: 'string' as const, description: 'Guest email address' },
  name: { type: 'string' as const, description: 'Guest full name' },
  firstName: { type: 'string' as const, description: 'Guest first name' },
  lastName: { type: 'string' as const, description: 'Guest last name' },
  approvalStatus: {
    type: 'string' as const,
    description:
      'Guest approval status (approved, session, pending_approval, invited, declined, waitlist)',
  },
  registeredAt: { type: 'string' as const, description: 'Registration timestamp (ISO 8601)' },
  invitedAt: { type: 'string' as const, description: 'Invitation timestamp (ISO 8601)' },
  joinedAt: { type: 'string' as const, description: 'Join timestamp (ISO 8601)' },
  checkedInAt: { type: 'string' as const, description: 'Check-in timestamp (ISO 8601)' },
  phoneNumber: { type: 'string' as const, description: 'Guest phone number' },
}
