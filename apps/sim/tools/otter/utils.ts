import { toBooleanOrNull, toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { toArray, toRecordOrNull } from '@sim/utils/object'
import type {
  OtterActionItem,
  OtterCalendarGuest,
  OtterChannel,
  OtterConversation,
  OtterConversationDetail,
  OtterCustomPrompt,
  OtterInsight,
  OtterOutlineSection,
  OtterSharedChannel,
  OtterSharedEmail,
  OtterTranscript,
  OtterUser,
  OtterWorkspace,
} from '@/tools/otter/types'
import type { OutputProperty } from '@/tools/types'

/**
 * Base URL for the Otter.ai Public API (Enterprise workspaces only).
 * @see https://help.otter.ai/hc/en-us/articles/36130822688279-Otter-ai-Public-API
 */
export const OTTER_API_BASE = 'https://api.otter.ai/v1'

/** Relationship names accepted by `GET /conversations/{id}?include=`. */
export const OTTER_CONVERSATION_INCLUDE_OPTIONS = [
  'action_items',
  'insights',
  'outline',
  'transcript',
  'all',
] as const

export function otterHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
  }
}

/**
 * Validate an optional page size against Otter's documented range (1-100).
 * Returns undefined when unset so the API default applies.
 */
export function parseOtterLimit(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const limit = Number(value)
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('Limit must be a whole number between 1 and 100')
  }
  return limit
}

/**
 * Normalize the `include` relationship list into the comma-separated form Otter
 * expects. Accepts an array, a JSON array string, or a comma-separated string.
 */
export function normalizeOtterInclude(value: unknown): string {
  let entries: unknown[] = []
  if (Array.isArray(value)) {
    entries = value
  } else if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.startsWith('[')) {
      try {
        entries = toArray(JSON.parse(trimmed))
      } catch {
        entries = [trimmed]
      }
    } else {
      entries = [trimmed]
    }
  }
  const parts = entries
    .flatMap((entry) => String(entry).split(','))
    .map((part) => part.trim())
    .filter(Boolean)
  const unique = [...new Set(parts.map((part) => part.toLowerCase()))]
  const allowed: readonly string[] = OTTER_CONVERSATION_INCLUDE_OPTIONS
  const invalid = unique.filter((part) => !allowed.includes(part))
  if (invalid.length > 0) {
    throw new Error(
      `Invalid include value(s): ${invalid.join(', ')}. Use ${OTTER_CONVERSATION_INCLUDE_OPTIONS.join(', ')}`
    )
  }
  if (unique.length === 0) {
    throw new Error(
      `At least one include value is required (${OTTER_CONVERSATION_INCLUDE_OPTIONS.join(', ')})`
    )
  }
  return unique.join(',')
}

/**
 * Normalize a webhook event name. Otter's docs name events
 * `conversation.completed` while its documented payload sends
 * `conversation_completed`, so both spellings map to the underscore form.
 */
export function normalizeOtterEvent(event: string): string {
  return event.trim().toLowerCase().replace(/\./g, '_')
}

/** Read an identifier, tolerating numeric IDs. Returns '' when absent. */
export function readOtterId(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return ''
}

/** Coerce a list of text entries, flattening the nested arrays some Otter payloads use. */
function mapTextList(value: unknown): string[] {
  return toArray(value)
    .flat(2)
    .map((entry) => toStringOrNull(entry))
    .filter((entry): entry is string => entry !== null)
}

export function mapOtterUser(value: unknown): OtterUser | null {
  const raw = toRecordOrNull(value)
  if (!raw) return null
  return {
    id: readOtterId(raw.id),
    name: toStringOrNull(raw.name),
    firstName: toStringOrNull(raw.first_name),
    lastName: toStringOrNull(raw.last_name),
    email: toStringOrNull(raw.email),
  }
}

export function mapOtterChannel(value: unknown): OtterChannel | null {
  const raw = toRecordOrNull(value)
  if (!raw) return null
  return {
    id: readOtterId(raw.id),
    name: toStringOrNull(raw.name),
    memberCount: toNumberOrNull(raw.member_count),
    owner: mapOtterUser(raw.owner),
    discoverability: toStringOrNull(raw.discoverability),
  }
}

function mapCalendarGuest(value: unknown): OtterCalendarGuest {
  const raw = toRecordOrNull(value) ?? {}
  return {
    name: toStringOrNull(raw.name),
    email: toStringOrNull(raw.email),
    permission: toStringOrNull(raw.permission),
  }
}

function mapSharedEmail(value: unknown): OtterSharedEmail {
  const raw = toRecordOrNull(value) ?? {}
  return {
    email: toStringOrNull(raw.email),
    user: mapOtterUser(raw.user),
    permission: toStringOrNull(raw.permission),
  }
}

function mapSharedChannel(value: unknown): OtterSharedChannel {
  const raw = toRecordOrNull(value) ?? {}
  return {
    channel: mapOtterChannel(raw.channel),
    permission: toStringOrNull(raw.permission),
  }
}

export function mapOtterConversation(value: unknown): OtterConversation {
  const raw = toRecordOrNull(value) ?? {}
  const processStatus = toRecordOrNull(raw.process_status)
  return {
    id: readOtterId(raw.id),
    title: toStringOrNull(raw.title),
    url: toStringOrNull(raw.url),
    owner: mapOtterUser(raw.owner),
    createdAt: toStringOrNull(raw.created_at),
    processStatus: processStatus
      ? {
          abstractSummary: toStringOrNull(processStatus.abstract_summary),
          actionItem: toStringOrNull(processStatus.action_item),
          outline: toStringOrNull(processStatus.outline),
        }
      : null,
    calendarGuests: toArray(raw.calendar_guests).map(mapCalendarGuest),
    sharedEmails: toArray(raw.shared_emails).map(mapSharedEmail),
    sharedChannels: toArray(raw.shared_channels).map(mapSharedChannel),
    abstractSummary: toStringOrNull(raw.abstract_summary),
    confJoinUrl: toStringOrNull(raw.conf_join_url),
  }
}

function mapActionItem(value: unknown): OtterActionItem {
  const raw = toRecordOrNull(value) ?? {}
  const status = toRecordOrNull(raw.status)
  return {
    id: readOtterId(raw.id),
    text: toStringOrNull(raw.text),
    assignee: mapOtterUser(raw.assignee),
    status: status
      ? {
          completed: toBooleanOrNull(status.completed),
          createdAt: toStringOrNull(status.created_at),
          lastModifiedAt: toStringOrNull(status.last_modified_at),
          completedAt: toStringOrNull(status.completed_at),
        }
      : null,
  }
}

function mapInsight(value: unknown): OtterInsight {
  const raw = toRecordOrNull(value) ?? {}
  return { topic: toStringOrNull(raw.topic), text: mapTextList(raw.text) }
}

function mapOutlineSection(value: unknown): OtterOutlineSection {
  const raw = toRecordOrNull(value) ?? {}
  return { section: toStringOrNull(raw.section), text: mapTextList(raw.text) }
}

function mapTranscript(value: unknown): OtterTranscript | null {
  const raw = toRecordOrNull(value)
  if (!raw) return null
  return { content: toStringOrNull(raw.content), format: toStringOrNull(raw.format) }
}

function mapCustomPrompt(value: unknown): OtterCustomPrompt | null {
  const raw = toRecordOrNull(value)
  if (!raw) return null
  return { label: toStringOrNull(raw.label), output: toStringOrNull(raw.output) }
}

/**
 * Map a conversation plus its `relationships`. A relationship that was not
 * requested (or not returned) maps to `null`, distinguishing it from an empty
 * list. Otter's prose places `relationships` beside `data` while its examples
 * nest it inside `data`, so pass the response `envelope` to accept either.
 * `custom_prompt` is documented inside `relationships` for the REST API
 * but at the conversation level in webhook payloads, so both are read.
 */
export function mapOtterConversationDetail(
  value: unknown,
  envelope?: unknown
): OtterConversationDetail {
  const raw = toRecordOrNull(value) ?? {}
  const relationships =
    toRecordOrNull(raw.relationships) ??
    toRecordOrNull(toRecordOrNull(envelope)?.relationships) ??
    {}
  const listOrNull = <T>(entry: unknown, map: (item: unknown) => T): T[] | null =>
    Array.isArray(entry) ? entry.map(map) : null
  return {
    ...mapOtterConversation(raw),
    actionItems: listOrNull(relationships.action_items, mapActionItem),
    insights: listOrNull(relationships.insights, mapInsight),
    outline: listOrNull(relationships.outline, mapOutlineSection),
    transcript: mapTranscript(relationships.transcript),
    customPrompt: mapCustomPrompt(relationships.custom_prompt ?? raw.custom_prompt),
  }
}

export function mapOtterWorkspace(value: unknown): OtterWorkspace {
  const raw = toRecordOrNull(value) ?? {}
  return {
    workspaceId:
      typeof raw.id === 'string' && /^\d+$/.test(raw.id) ? Number(raw.id) : toNumberOrNull(raw.id),
    name: toStringOrNull(raw.name),
    owner: mapOtterUser(raw.owner),
    memberCount: toNumberOrNull(raw.member_count),
    handle: toStringOrNull(raw.handle),
    type: toStringOrNull(raw.type),
  }
}

/** Read `meta.retrieved_at`, which every Otter response carries. */
export function readOtterRetrievedAt(body: unknown): string | null {
  return toStringOrNull(toRecordOrNull(toRecordOrNull(body)?.meta)?.retrieved_at)
}

/**
 * Read the pagination `meta` of a cursor-paginated list. A missing or
 * non-boolean `has_more` throws rather than reading as the last page, which
 * would silently hide the remaining conversations.
 */
export function readOtterPagination(body: unknown): {
  retrievedAt: string | null
  hasMore: boolean
  nextCursor: string | null
} {
  const meta = toRecordOrNull(toRecordOrNull(body)?.meta)
  if (typeof meta?.has_more !== 'boolean') {
    throw new Error('Unexpected Otter API response: missing meta.has_more')
  }
  return {
    retrievedAt: toStringOrNull(meta.retrieved_at),
    hasMore: meta.has_more,
    nextCursor: toStringOrNull(meta.next_cursor),
  }
}

/**
 * Read the `data` list of a list response. A body without an array `data`
 * throws rather than reading as an empty result.
 */
export function readOtterDataList(body: unknown): unknown[] {
  const data = toRecordOrNull(body)?.data
  if (!Array.isArray(data)) {
    throw new Error('Unexpected Otter API response: missing data array')
  }
  return data
}

/** Read the `data` object of a single-resource response. */
export function readOtterDataObject(body: unknown): Record<string, unknown> {
  const data = toRecordOrNull(toRecordOrNull(body)?.data)
  if (!data) {
    throw new Error('Unexpected Otter API response: missing data object')
  }
  return data
}

export const OTTER_USER_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'User ID' },
  name: { type: 'string', description: 'Full name', nullable: true },
  firstName: { type: 'string', description: 'First name', nullable: true },
  lastName: { type: 'string', description: 'Last name', nullable: true },
  email: { type: 'string', description: 'Email address', nullable: true },
}

export const OTTER_CHANNEL_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'Channel ID' },
  name: { type: 'string', description: 'Channel name', nullable: true },
  memberCount: { type: 'number', description: 'Number of channel members', nullable: true },
  owner: {
    type: 'object',
    description: 'Channel owner',
    nullable: true,
    properties: OTTER_USER_PROPERTIES,
  },
  discoverability: {
    type: 'string',
    description: 'Channel visibility, such as private or workspace (public)',
    nullable: true,
  },
}

export const OTTER_CONVERSATION_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'Conversation ID' },
  title: { type: 'string', description: 'Conversation title', nullable: true },
  url: { type: 'string', description: 'URL to view the conversation in Otter', nullable: true },
  owner: {
    type: 'object',
    description: 'Conversation owner',
    nullable: true,
    properties: OTTER_USER_PROPERTIES,
  },
  createdAt: { type: 'string', description: 'When the conversation was created', nullable: true },
  processStatus: {
    type: 'object',
    description:
      'Processing status of generated data (e.g., "finished"); a field is null when not yet available',
    nullable: true,
    properties: {
      abstractSummary: { type: 'string', description: 'Summary status', nullable: true },
      actionItem: { type: 'string', description: 'Action item status', nullable: true },
      outline: { type: 'string', description: 'Outline status', nullable: true },
    },
  },
  calendarGuests: {
    type: 'array',
    description: 'Guests invited to the associated calendar event',
    items: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Guest name', nullable: true },
        email: { type: 'string', description: 'Guest email', nullable: true },
        permission: {
          type: 'string',
          description: 'Guest permission (present in webhook payloads)',
          nullable: true,
        },
      },
    },
  },
  sharedEmails: {
    type: 'array',
    description: 'Users or email addresses the conversation is shared with',
    items: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'Shared email address', nullable: true },
        user: {
          type: 'object',
          description: 'Otter user for the email, if any',
          nullable: true,
          properties: OTTER_USER_PROPERTIES,
        },
        permission: {
          type: 'string',
          description: 'Share permission (e.g., collaborate)',
          nullable: true,
        },
      },
    },
  },
  sharedChannels: {
    type: 'array',
    description: 'Channels the conversation is shared with',
    items: {
      type: 'object',
      properties: {
        channel: {
          type: 'object',
          description: 'The channel',
          nullable: true,
          properties: OTTER_CHANNEL_PROPERTIES,
        },
        permission: {
          type: 'string',
          description: 'Share permission (e.g., collaborate)',
          nullable: true,
        },
      },
    },
  },
  abstractSummary: {
    type: 'string',
    description: 'AI-generated summary of the conversation',
    nullable: true,
  },
  confJoinUrl: {
    type: 'string',
    description: 'Meeting join URL (Zoom, Google Meet, Microsoft Teams, etc.)',
    nullable: true,
  },
}

export const OTTER_CONVERSATION_RELATIONSHIP_PROPERTIES: Record<string, OutputProperty> = {
  actionItems: {
    type: 'array',
    description: 'AI-detected action items (null unless requested with include)',
    nullable: true,
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Action item ID' },
        text: { type: 'string', description: 'Action item text', nullable: true },
        assignee: {
          type: 'object',
          description: 'Assigned user',
          nullable: true,
          properties: OTTER_USER_PROPERTIES,
        },
        status: {
          type: 'object',
          description: 'Completion status',
          nullable: true,
          properties: {
            completed: { type: 'boolean', description: 'Whether completed', nullable: true },
            createdAt: { type: 'string', description: 'When created', nullable: true },
            lastModifiedAt: { type: 'string', description: 'When last modified', nullable: true },
            completedAt: { type: 'string', description: 'When completed', nullable: true },
          },
        },
      },
    },
  },
  insights: {
    type: 'array',
    description: 'Key topics discussed (null unless requested with include)',
    nullable: true,
    items: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'Insight topic (e.g., Decisions)', nullable: true },
        text: { type: 'array', description: 'Insight points', items: { type: 'string' } },
      },
    },
  },
  outline: {
    type: 'array',
    description: 'Meeting outline sections (null unless requested with include)',
    nullable: true,
    items: {
      type: 'object',
      properties: {
        section: { type: 'string', description: 'Section heading', nullable: true },
        text: { type: 'array', description: 'Section points', items: { type: 'string' } },
      },
    },
  },
  transcript: {
    type: 'object',
    description: 'Full transcript (null unless requested with include)',
    nullable: true,
    properties: {
      content: { type: 'string', description: 'Transcript text', nullable: true },
      format: { type: 'string', description: 'Transcript format (e.g., txt)', nullable: true },
    },
  },
  customPrompt: {
    type: 'object',
    description: 'Output of a custom prompt configured in Otter, if any',
    nullable: true,
    properties: {
      label: { type: 'string', description: 'Prompt label', nullable: true },
      output: { type: 'string', description: 'Prompt output', nullable: true },
    },
  },
}

export const OTTER_RETRIEVED_AT_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'When Otter retrieved the data (ISO 8601)',
  nullable: true,
}

export const OTTER_PAGINATION_OUTPUTS: Record<string, OutputProperty> = {
  retrievedAt: OTTER_RETRIEVED_AT_OUTPUT,
  hasMore: { type: 'boolean', description: 'Whether more pages are available' },
  nextCursor: {
    type: 'string',
    description: 'Cursor for the next page; pass it as Cursor to continue',
    nullable: true,
  },
}
