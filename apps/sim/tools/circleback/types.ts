import type { OutputProperty, ToolResponse } from '@/tools/types'

/** A tag attached to a meeting or defined in the workspace. */
export const TAG_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'The unique identifier of the tag' },
  name: { type: 'string', description: 'The display name of the tag' },
  description: { type: 'string', nullable: true, description: 'A description of the tag' },
} as const satisfies Record<string, OutputProperty>

/** A meeting attendee, resolved from the calendar invite or the live participants. */
export const ATTENDEE_OUTPUT_PROPERTIES = {
  profileId: { type: 'number', description: 'The unique identifier of the attendee profile' },
  name: { type: 'string', nullable: true, description: 'The attendee name' },
  title: { type: 'string', nullable: true, description: 'The attendee job title' },
  companyName: {
    type: 'string',
    nullable: true,
    description: 'The name of the company the attendee belongs to',
  },
  email: { type: 'string', nullable: true, description: 'The attendee email address' },
  isCalendarEventOrganizer: {
    type: 'boolean',
    description: 'Whether the attendee organized the calendar event',
  },
  isCalendarInvitee: {
    type: 'boolean',
    description: 'Whether the attendee was invited on the calendar event',
  },
} as const satisfies Record<string, OutputProperty>

/** An action item embedded in a meeting payload. */
export const MEETING_ACTION_ITEM_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'The unique identifier of the action item' },
  title: { type: 'string', description: 'The action item title' },
  description: { type: 'string', description: 'The action item description' },
  assignee: {
    type: 'json',
    nullable: true,
    description:
      'The assignee as an object with profileId, name, title, companyName, and email, or null if unassigned',
  },
  status: { type: 'string', description: 'The completion status, PENDING or DONE' },
} as const satisfies Record<string, OutputProperty>

/** A full meeting as returned by the get, list, search, and tag operations. */
export const MEETING_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'The Circleback meeting ID' },
  name: { type: 'string', nullable: true, description: 'The meeting name' },
  createdAt: { type: 'string', description: 'When the meeting was created (ISO 8601)' },
  updatedAt: { type: 'string', description: 'When the meeting was last updated (ISO 8601)' },
  duration: { type: 'number', nullable: true, description: 'The meeting duration in seconds' },
  url: {
    type: 'string',
    nullable: true,
    description: 'The URL of the virtual meeting (Zoom, Google Meet, or Microsoft Teams)',
  },
  recordingUrl: {
    type: 'string',
    nullable: true,
    description: 'The URL of the meeting recording file, valid for 24 hours',
  },
  tags: {
    type: 'array',
    description: 'Tags added to the meeting',
    items: { type: 'object', properties: TAG_OUTPUT_PROPERTIES },
  },
  icalUid: {
    type: 'string',
    nullable: true,
    description: 'The identifier of the calendar event associated with the meeting',
  },
  attendees: {
    type: 'array',
    description: 'The meeting attendees',
    items: { type: 'object', properties: ATTENDEE_OUTPUT_PROPERTIES },
  },
  notes: {
    type: 'string',
    nullable: true,
    description: 'The meeting notes with Markdown formatting',
  },
  privateNotes: {
    type: 'string',
    nullable: true,
    description: 'The authenticated user private notes for the meeting',
  },
  actionItems: {
    type: 'array',
    description: 'Action items created for the meeting',
    items: { type: 'object', properties: MEETING_ACTION_ITEM_OUTPUT_PROPERTIES },
  },
  insights: {
    type: 'json',
    description: 'Insight results for the meeting, keyed by the name of the user-created insight',
  },
  linkAccess: {
    type: 'string',
    nullable: true,
    description:
      'Who can access the meeting through its shareable link: Editor, Viewer, or LimitedViewer',
  },
  calendarEvent: {
    type: 'json',
    nullable: true,
    description:
      'The associated calendar event as an object with id, icalUid, description, platform, and platformId, or null',
  },
} as const satisfies Record<string, OutputProperty>

/** A standalone action item as returned by the action item operations. */
export const ACTION_ITEM_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'The unique identifier of the action item' },
  title: { type: 'string', description: 'The action item title' },
  description: { type: 'string', description: 'The action item description' },
  assignee: {
    type: 'json',
    nullable: true,
    description:
      'The assignee as an object with profileId, name, title, companyName, and email, or null if unassigned',
  },
  completedAt: {
    type: 'string',
    nullable: true,
    description: 'When the action item was marked done, or null if not completed',
  },
  meetingId: {
    type: 'string',
    nullable: true,
    description: 'The ID of the meeting the action item belongs to, or null',
  },
  status: { type: 'string', description: 'The completion status, PENDING or DONE' },
  meetings: {
    type: 'array',
    description: 'The meetings the action item is associated with',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The Circleback meeting ID' },
        name: { type: 'string', nullable: true, description: 'The meeting name' },
        createdAt: { type: 'string', description: 'When the meeting was created (ISO 8601)' },
      },
    },
  },
  canEditActionItem: {
    type: 'boolean',
    optional: true,
    description: 'Whether the caller may edit the action item. Returned only by the list operation',
  },
} as const satisfies Record<string, OutputProperty>

/** A person who attends the authenticated user's meetings. */
export const PERSON_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'The unique identifier of the person' },
  title: { type: 'string', nullable: true, description: 'The person job title' },
  companyId: {
    type: 'number',
    nullable: true,
    description: 'The unique identifier of the company the person belongs to',
  },
  companyName: {
    type: 'string',
    nullable: true,
    description: 'The name of the company the person belongs to',
  },
  email: { type: 'string', nullable: true, description: 'The person email address' },
  firstName: { type: 'string', nullable: true, description: 'The person first name' },
  lastName: { type: 'string', nullable: true, description: 'The person last name' },
} as const satisfies Record<string, OutputProperty>

/** A link to a person or company on an external platform or connected integration. */
export const EXTERNAL_LINK_OUTPUT_PROPERTIES = {
  url: { type: 'string', description: 'The URL of the external resource' },
  objectType: {
    type: 'string',
    description: 'Whether the link refers to a person or a company',
  },
  type: {
    type: 'string',
    description:
      'The platform or integration the link points to, such as Attio, HubSpot, Linear, Salesforce, Zoho, linkedin, or website',
  },
} as const satisfies Record<string, OutputProperty>

/** A segment of a meeting transcript. */
export const TRANSCRIPT_SEGMENT_OUTPUT_PROPERTIES = {
  speaker: { type: 'string', nullable: true, description: 'The speaker name' },
  text: { type: 'string', description: 'The words spoken' },
  timestamp: {
    type: 'number',
    description: 'The timestamp in seconds that marks the beginning of the segment',
  },
} as const satisfies Record<string, OutputProperty>

/** An upcoming calendar event from the authenticated user's connected calendars. */
export const CALENDAR_EVENT_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'The unique identifier of the calendar meeting' },
  title: { type: 'string', description: 'The title of the calendar meeting' },
  icalUid: { type: 'string', description: 'The iCalendar UID of the calendar event' },
  attendees: {
    type: 'array',
    description: 'The attendees invited to the calendar meeting',
    items: {
      type: 'object',
      properties: {
        name: { type: 'string', nullable: true, description: 'The name of the attendee' },
        email: { type: 'string', description: 'The email address of the attendee' },
        isOrganizer: {
          type: 'boolean',
          description: 'Whether the attendee organized the calendar meeting',
        },
        status: {
          type: 'string',
          description:
            'The attendee response to the invitation: accepted, declined, tentative, or not_available',
        },
      },
    },
  },
  calendarDescription: {
    type: 'string',
    optional: true,
    description: 'The description of the calendar event',
  },
  calendarPlatform: {
    type: 'string',
    description: 'The calendar platform the meeting was synced from',
  },
  startTime: {
    type: 'string',
    description: 'When the calendar meeting starts (ISO 8601)',
  },
  endTime: { type: 'string', description: 'When the calendar meeting ends (ISO 8601)' },
  isExternal: {
    type: 'boolean',
    description: 'Whether the meeting includes attendees from more than one email domain',
  },
  isHostedByMe: {
    type: 'boolean',
    description: 'Whether the current user organized the calendar meeting',
  },
  location: {
    type: 'string',
    optional: true,
    description: 'The location of the calendar meeting',
  },
  meetingId: {
    type: 'string',
    optional: true,
    description: 'The Circleback meeting associated with the calendar meeting, when one exists',
  },
  meetingPlatform: {
    type: 'string',
    nullable: true,
    description: 'The conferencing platform hosting the meeting, when detected',
  },
  organizerEmail: {
    type: 'string',
    nullable: true,
    description: 'The email address of the meeting organizer',
  },
  platform: {
    type: 'string',
    nullable: true,
    description:
      'The conferencing platform hosting the meeting, when detected. Alias of meetingPlatform',
  },
  overrideShouldRecord: {
    type: 'boolean',
    nullable: true,
    description:
      'Whether the user manually overrode the automatic recording decision, or null when no override is set',
  },
  recurringEventId: {
    type: 'string',
    optional: true,
    description: 'The identifier of the recurring event series the meeting belongs to',
  },
  willRecord: {
    type: 'boolean',
    description: 'Whether the notetaker will join and record the meeting',
  },
  willRecordReason: {
    type: 'string',
    description: 'A human-readable explanation of why the meeting will or will not be recorded',
  },
} as const satisfies Record<string, OutputProperty>

/** A meeting attendee mapped to Sim's output shape. */
export interface CirclebackAttendee {
  profileId: number
  name: string | null
  title: string | null
  companyName: string | null
  email: string | null
  isCalendarEventOrganizer: boolean
  isCalendarInvitee: boolean
}

/** A mapped tag. */
export interface CirclebackTag {
  id: number
  name: string
  description: string | null
}

/** An assignee reference on an action item. */
export interface CirclebackAssignee {
  profileId: number
  name: string | null
  title: string | null
  companyName: string | null
  email: string | null
}

/** A full meeting mapped to Sim's output shape. */
export interface CirclebackMeeting {
  id: string
  name: string | null
  createdAt: string
  updatedAt: string
  duration: number | null
  url: string | null
  recordingUrl: string | null
  tags: CirclebackTag[]
  icalUid: string | null
  attendees: CirclebackAttendee[]
  notes: string | null
  privateNotes: string | null
  actionItems: {
    id: number
    title: string
    description: string
    assignee: CirclebackAssignee | null
    status: string
  }[]
  insights: Record<string, unknown>
  linkAccess: string | null
  calendarEvent: Record<string, unknown> | null
}

/** A standalone action item mapped to Sim's output shape. */
export interface CirclebackActionItem {
  id: number
  title: string
  description: string
  assignee: CirclebackAssignee | null
  completedAt: string | null
  meetingId: string | null
  status: string
  meetings: { id: string; name: string | null; createdAt: string }[]
}

/** A person mapped to Sim's output shape. */
export interface CirclebackPerson {
  id: number
  title: string | null
  companyId: number | null
  companyName: string | null
  email: string | null
  firstName: string | null
  lastName: string | null
}

/** An external link mapped to Sim's output shape. */
export interface CirclebackExternalLink {
  url: string
  objectType: string
  type: string
}

export interface CirclebackListMeetingsParams {
  apiKey: string
  ownership?: string
  statuses?: string
  tagIds?: string
  attendeeProfileIds?: string
  cursor?: string
}

export interface CirclebackGetMeetingParams {
  apiKey: string
  meetingId: string
}

export interface CirclebackUpdateMeetingParams {
  apiKey: string
  meetingId: string
  name?: string
  notes?: string
  privateNotes?: string
}

export interface CirclebackDeleteMeetingParams {
  apiKey: string
  meetingId: string
}

export interface CirclebackGetTranscriptParams {
  apiKey: string
  meetingId: string
}

export interface CirclebackSearchMeetingsParams {
  apiKey: string
  searchTerm?: string
  meetingIds?: string
  tagIds?: string
  attendeeProfileIds?: string
  cursor?: string
}

export interface CirclebackListActionItemsParams {
  apiKey: string
  assigneeType?: string
  assigneeProfileId?: string
  assigneeTeamId?: string
  status?: string
  attendeeProfileIds?: string
  tagIds?: string
  cursor?: string
}

export interface CirclebackUpdateActionItemParams {
  apiKey: string
  actionItemId: string
  title?: string
  description?: string
  assigneeProfileId?: string
  status?: string
}

export interface CirclebackDeleteActionItemParams {
  apiKey: string
  actionItemId: string
}

export interface CirclebackListCalendarEventsParams {
  apiKey: string
  includeOfflineSingleAttendee?: string
  startTimeLookbackHours?: string
  startTimeLookaheadHours?: string
  sortDirection?: string
  cursor?: string
}

export interface CirclebackListCompaniesParams {
  apiKey: string
  tagIds?: string
  cursor?: string
}

export interface CirclebackGetCompanyParams {
  apiKey: string
  domain: string
}

export interface CirclebackListPeopleParams {
  apiKey: string
  domains?: string
  tagIds?: string
  limit?: string
  cursor?: string
}

export interface CirclebackGetPersonParams {
  apiKey: string
  profileId: string
}

export interface CirclebackListTagsParams {
  apiKey: string
}

export interface CirclebackCreateTagParams {
  apiKey: string
  tagName: string
  tagDescription?: string
}

export interface CirclebackUpdateTagParams {
  apiKey: string
  tagId: string
  tagName?: string
  tagDescription?: string
}

export interface CirclebackDeleteTagParams {
  apiKey: string
  tagId: string
}

export interface CirclebackTagMeetingsParams {
  apiKey: string
  tagId: string
  meetingIds?: string
}

export interface CirclebackMeetingListResponse extends ToolResponse {
  output: {
    meetings: CirclebackMeeting[]
    nextCursor: string | null
    hasMore: boolean
  }
}

export interface CirclebackMeetingResponse extends ToolResponse {
  output: CirclebackMeeting
}

export interface CirclebackTranscriptResponse extends ToolResponse {
  output: {
    transcript: { speaker: string | null; text: string; timestamp: number }[]
  }
}

export interface CirclebackActionItemListResponse extends ToolResponse {
  output: {
    actionItems: (CirclebackActionItem & { canEditActionItem: boolean })[]
    nextCursor: string | null
    hasMore: boolean
  }
}

export interface CirclebackActionItemResponse extends ToolResponse {
  output: CirclebackActionItem
}

export interface CirclebackCalendarEventListResponse extends ToolResponse {
  output: {
    events: Record<string, unknown>[]
    nextCursor: string | null
    hasMore: boolean
  }
}

export interface CirclebackCompanyListResponse extends ToolResponse {
  output: {
    companies: {
      id: number
      name: string | null
      avatarUrl: string | null
      domain: string
    }[]
    nextCursor: string | null
    hasMore: boolean
  }
}

export interface CirclebackCompanyResponse extends ToolResponse {
  output: {
    name: string | null
    avatarUrl: string | null
    domain: string
    externalLinks: CirclebackExternalLink[]
    people: CirclebackPerson[]
  }
}

export interface CirclebackPersonListResponse extends ToolResponse {
  output: {
    people: CirclebackPerson[]
    nextCursor: string | null
    hasMore: boolean
  }
}

export interface CirclebackPersonResponse extends ToolResponse {
  output: CirclebackPerson & { externalLinks: CirclebackExternalLink[] }
}

export interface CirclebackTaggedMeetingsResponse extends ToolResponse {
  output: {
    meetings: CirclebackMeeting[]
  }
}

export interface CirclebackTagListResponse extends ToolResponse {
  output: {
    tags: CirclebackTag[]
  }
}

export interface CirclebackTagResponse extends ToolResponse {
  output: CirclebackTag
}
