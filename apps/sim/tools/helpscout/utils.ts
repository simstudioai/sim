import { toBooleanOrNull, toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { toArray, toRecord } from '@sim/utils/object'
import type {
  HelpScoutAttachment,
  HelpScoutConversation,
  HelpScoutCustomer,
  HelpScoutCustomerEntry,
  HelpScoutFolder,
  HelpScoutMailbox,
  HelpScoutPage,
  HelpScoutPerson,
  HelpScoutTag,
  HelpScoutTeam,
  HelpScoutThread,
  HelpScoutUser,
  HelpScoutWorkflow,
} from '@/tools/helpscout/types'
import { HELPSCOUT_PAGE_PROPERTIES } from '@/tools/helpscout/types'
import type { OutputProperty } from '@/tools/types'

export const HELPSCOUT_API_BASE = 'https://api.helpscout.net/v2'

const HELPSCOUT_ID_PATTERN = /^\d{1,16}$/

export function buildHelpScoutHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
}

/** Help Scout IDs are positive integers; reject anything else before it reaches a URL or body. */
export function parseHelpScoutId(value: unknown, paramName: string): number {
  const text = typeof value === 'number' ? String(value) : (toStringOrNull(value)?.trim() ?? '')
  if (
    !HELPSCOUT_ID_PATTERN.test(text) ||
    !Number.isSafeInteger(Number(text)) ||
    Number(text) <= 0
  ) {
    throw new Error(`${paramName} must be a numeric Help Scout ID`)
  }
  return Number(text)
}

export function parseOptionalHelpScoutId(value: unknown, paramName: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return parseHelpScoutId(value, paramName)
}

/** Accepts an array or a comma-separated string and returns trimmed, non-empty entries. */
export function toStringList(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : (toStringOrNull(value)?.split(',') ?? [])
  return entries.map((entry) => String(entry).trim()).filter(Boolean)
}

export function buildHelpScoutUrl(
  path: string,
  query: Record<string, string | number | undefined>
): string {
  const url = new URL(`${HELPSCOUT_API_BASE}${path}`)
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === '') continue
    url.searchParams.set(key, String(value))
  }
  return url.toString()
}

export function validateConversationNumber(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('number must be a positive integer')
  }
  return value
}

export function validatePage(page: number | undefined): number | undefined {
  if (page === undefined) return undefined
  if (!Number.isInteger(page) || page < 1) throw new Error('page must be a positive integer')
  return page
}

/**
 * Created resources come back as `201` with an empty body; the new ID is only in the
 * `Resource-ID` header.
 */
export function readResourceId(response: Response): number | null {
  return parseIdText(response.headers.get('resource-id'))
}

/** Parses an ID carried as text (a header or query string), or null when it is not one. */
function parseIdText(value: string | null): number | null {
  const text = value?.trim() ?? ''
  return HELPSCOUT_ID_PATTERN.test(text) && Number.isSafeInteger(Number(text)) ? Number(text) : null
}

export function projectPage(data: Record<string, unknown>): {
  page: HelpScoutPage
  nextPage: number | null
} {
  const page = toRecord(data.page)
  const nextHref = toStringOrNull(toRecord(toRecord(data._links).next).href)
  let nextPage: number | null = null
  if (nextHref) {
    try {
      nextPage = parseIdText(new URL(nextHref).searchParams.get('page'))
    } catch {
      nextPage = null
    }
  }
  return {
    page: {
      number: toNumberOrNull(page.number),
      size: toNumberOrNull(page.size),
      totalElements: toNumberOrNull(page.totalElements),
      totalPages: toNumberOrNull(page.totalPages),
    },
    nextPage,
  }
}

export function embeddedList(data: Record<string, unknown>, key: string): unknown[] {
  return toArray(toRecord(data._embedded)[key])
}

function stringList(value: unknown): string[] {
  return toArray(value).filter((entry): entry is string => typeof entry === 'string')
}

function projectPerson(value: unknown): HelpScoutPerson | null {
  const data = toRecord(value)
  if (Object.keys(data).length === 0) return null
  return {
    id: toNumberOrNull(data.id),
    type: toStringOrNull(data.type),
    first: toStringOrNull(data.first),
    last: toStringOrNull(data.last),
    email: toStringOrNull(data.email),
  }
}

export function projectConversation(value: unknown): HelpScoutConversation {
  const data = toRecord(value)
  const source = toRecord(data.source)
  return {
    id: toNumberOrNull(data.id),
    number: toNumberOrNull(data.number),
    threadCount: toNumberOrNull(data.threads),
    type: toStringOrNull(data.type),
    folderId: toNumberOrNull(data.folderId),
    status: toStringOrNull(data.status),
    state: toStringOrNull(data.state),
    subject: toStringOrNull(data.subject),
    preview: toStringOrNull(data.preview),
    mailboxId: toNumberOrNull(data.mailboxId),
    assignee: projectPerson(data.assignee),
    createdBy: projectPerson(data.createdBy),
    primaryCustomer: projectPerson(data.primaryCustomer),
    createdAt: toStringOrNull(data.createdAt),
    closedAt: toStringOrNull(data.closedAt),
    closedBy: toNumberOrNull(data.closedBy),
    userUpdatedAt: toStringOrNull(data.userUpdatedAt),
    customerWaitingSince: toStringOrNull(toRecord(data.customerWaitingSince).time),
    sourceType: toStringOrNull(source.type),
    sourceVia: toStringOrNull(source.via),
    tags: toArray(data.tags).map((entry) => {
      const tag = toRecord(entry)
      return {
        id: toNumberOrNull(tag.id),
        tag: toStringOrNull(tag.tag),
        color: toStringOrNull(tag.color),
      }
    }),
    cc: stringList(data.cc),
    bcc: stringList(data.bcc),
    customFields: toArray(data.customFields).map((entry) => {
      const field = toRecord(entry)
      return {
        id: toNumberOrNull(field.id),
        name: toStringOrNull(field.name),
        value: toStringOrNull(field.value),
        text: toStringOrNull(field.text),
      }
    }),
    webUrl: toStringOrNull(toRecord(toRecord(data._links).web).href),
  }
}

function projectAttachment(value: unknown): HelpScoutAttachment {
  const data = toRecord(value)
  return {
    id: toNumberOrNull(data.id),
    filename: toStringOrNull(data.filename),
    mimeType: toStringOrNull(data.mimeType),
    size: toNumberOrNull(data.size),
    state: toStringOrNull(data.state),
  }
}

export function projectThread(value: unknown): HelpScoutThread {
  const data = toRecord(value)
  const source = toRecord(data.source)
  return {
    id: toNumberOrNull(data.id),
    type: toStringOrNull(data.type),
    status: toStringOrNull(data.status),
    state: toStringOrNull(data.state),
    body: toStringOrNull(data.body),
    sourceType: toStringOrNull(source.type),
    sourceVia: toStringOrNull(source.via),
    customer: projectPerson(data.customer),
    createdBy: projectPerson(data.createdBy),
    assignedTo: projectPerson(data.assignedTo),
    to: stringList(data.to),
    cc: stringList(data.cc),
    bcc: stringList(data.bcc),
    createdAt: toStringOrNull(data.createdAt),
    openedAt: toStringOrNull(data.openedAt),
    savedReplyId: toNumberOrNull(data.savedReplyId),
    attachments: embeddedList(data, 'attachments').map(projectAttachment),
  }
}

function projectCustomerEntries(value: unknown): HelpScoutCustomerEntry[] {
  return toArray(value).map((entry) => {
    const data = toRecord(entry)
    return {
      id: toNumberOrNull(data.id),
      value: toStringOrNull(data.value),
      type: toStringOrNull(data.type),
    }
  })
}

export function projectCustomer(value: unknown): HelpScoutCustomer {
  const data = toRecord(value)
  const embedded = toRecord(data._embedded)
  return {
    id: toNumberOrNull(data.id),
    firstName: toStringOrNull(data.firstName),
    lastName: toStringOrNull(data.lastName),
    gender: toStringOrNull(data.gender),
    jobTitle: toStringOrNull(data.jobTitle),
    location: toStringOrNull(data.location),
    organization: toStringOrNull(data.organization),
    organizationId: toNumberOrNull(data.organizationId),
    photoType: toStringOrNull(data.photoType),
    photoUrl: toStringOrNull(data.photoUrl),
    age: toStringOrNull(data.age),
    background: toStringOrNull(data.background),
    conversationCount: toNumberOrNull(data.conversationCount),
    draft: toBooleanOrNull(data.draft),
    createdAt: toStringOrNull(data.createdAt),
    updatedAt: toStringOrNull(data.updatedAt),
    emails: projectCustomerEntries(embedded.emails),
    phones: projectCustomerEntries(embedded.phones),
    websites: projectCustomerEntries(embedded.websites),
    socialProfiles: projectCustomerEntries(embedded.social_profiles),
    chats: projectCustomerEntries(embedded.chats),
    properties: toArray(embedded.properties).map((entry) => {
      const property = toRecord(entry)
      return {
        slug: toStringOrNull(property.slug),
        name: toStringOrNull(property.name),
        type: toStringOrNull(property.type),
        value:
          typeof property.value === 'number'
            ? String(property.value)
            : toStringOrNull(property.value),
        text:
          typeof property.text === 'number' ? String(property.text) : toStringOrNull(property.text),
      }
    }),
  }
}

export function projectMailbox(value: unknown): HelpScoutMailbox {
  const data = toRecord(value)
  return {
    id: toNumberOrNull(data.id),
    name: toStringOrNull(data.name),
    slug: toStringOrNull(data.slug),
    email: toStringOrNull(data.email),
    createdAt: toStringOrNull(data.createdAt),
    updatedAt: toStringOrNull(data.updatedAt),
  }
}

export function projectFolder(value: unknown): HelpScoutFolder {
  const data = toRecord(value)
  return {
    id: toNumberOrNull(data.id),
    name: toStringOrNull(data.name),
    type: toStringOrNull(data.type),
    userId: toNumberOrNull(data.userId),
    totalCount: toNumberOrNull(data.totalCount),
    activeCount: toNumberOrNull(data.activeCount),
    updatedAt: toStringOrNull(data.updatedAt),
  }
}

export function projectUser(value: unknown): HelpScoutUser {
  const data = toRecord(value)
  return {
    id: toNumberOrNull(data.id),
    firstName: toStringOrNull(data.firstName),
    lastName: toStringOrNull(data.lastName),
    email: toStringOrNull(data.email),
    role: toStringOrNull(data.role),
    timezone: toStringOrNull(data.timezone),
    photoUrl: toStringOrNull(data.photoUrl),
    type: toStringOrNull(data.type),
    mention: toStringOrNull(data.mention),
    initials: toStringOrNull(data.initials),
    jobTitle: toStringOrNull(data.jobTitle),
    phone: toStringOrNull(data.phone),
    alternateEmails: stringList(data.alternateEmails),
    createdAt: toStringOrNull(data.createdAt),
    updatedAt: toStringOrNull(data.updatedAt),
  }
}

export function projectTag(value: unknown): HelpScoutTag {
  const data = toRecord(value)
  return {
    id: toNumberOrNull(data.id),
    name: toStringOrNull(data.name),
    slug: toStringOrNull(data.slug),
    ticketCount: toNumberOrNull(data.ticketCount),
    createdAt: toStringOrNull(data.createdAt),
    updatedAt: toStringOrNull(data.updatedAt),
  }
}

export function projectTeam(value: unknown): HelpScoutTeam {
  const data = toRecord(value)
  return {
    id: toNumberOrNull(data.id),
    name: toStringOrNull(data.name),
    mention: toStringOrNull(data.mention),
    initials: toStringOrNull(data.initials),
    timezone: toStringOrNull(data.timezone),
    photoUrl: toStringOrNull(data.photoUrl),
    createdAt: toStringOrNull(data.createdAt),
    updatedAt: toStringOrNull(data.updatedAt),
  }
}

export function projectWorkflow(value: unknown): HelpScoutWorkflow {
  const data = toRecord(value)
  return {
    id: toNumberOrNull(data.id),
    mailboxId: toNumberOrNull(data.mailboxId),
    type: toStringOrNull(data.type),
    status: toStringOrNull(data.status),
    order: toNumberOrNull(data.order),
    name: toStringOrNull(data.name),
    createdAt: toStringOrNull(data.createdAt),
    modifiedAt: toStringOrNull(data.modifiedAt),
  }
}

/** Shared `page` and `nextPage` outputs for every list tool. */
export const LIST_PAGE_OUTPUTS = {
  page: {
    type: 'json',
    description: 'Pagination details',
    properties: HELPSCOUT_PAGE_PROPERTIES,
  },
  nextPage: {
    type: 'number',
    description: 'Page number to request next, or null on the last page',
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>

export const ACCESS_TOKEN_PARAM = {
  type: 'string',
  required: true,
  visibility: 'hidden',
  description: 'Help Scout access token',
} as const

export const PAGE_PARAM = {
  type: 'number',
  required: false,
  visibility: 'user-or-llm',
  description: 'Page number to fetch, starting at 1',
} as const

export const CONVERSATION_ID_PARAM = {
  type: 'string',
  required: true,
  visibility: 'user-or-llm',
  description: 'Conversation ID',
} as const

export const CONVERSATION_CHANGE_OUTPUTS = {
  conversationId: {
    type: 'number',
    description: 'ID of the updated conversation',
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>

export function conversationUrl(conversationId: string, suffix = ''): string {
  return `${HELPSCOUT_API_BASE}/conversations/${parseHelpScoutId(conversationId, 'conversationId')}${suffix}`
}

/** Change endpoints answer `204 No Content`, so the result echoes the conversation that changed. */
export function conversationChangeResult(params?: { conversationId: string }) {
  return {
    success: true,
    output: {
      conversationId: params ? parseHelpScoutId(params.conversationId, 'conversationId') : null,
    },
  }
}

const THREAD_STATUSES = new Set(['active', 'pending', 'closed', 'open', 'spam', 'inbox_predefined'])

/** Optional conversation status a new reply or note applies. */
export function parseThreadStatus(value: string | undefined): string | undefined {
  const status = value?.trim()
  if (!status) return undefined
  if (!THREAD_STATUSES.has(status)) {
    throw new Error('status must be active, pending, closed, open, spam, or inbox_predefined')
  }
  return status
}

export const THREAD_STATUS_PARAM = {
  type: 'string',
  required: false,
  visibility: 'user-or-llm',
  description:
    'Conversation status to set with the thread: active, pending, closed, open, spam, or inbox_predefined (the inbox default)',
} as const

export const ACTING_USER_PARAM = {
  type: 'string',
  required: false,
  visibility: 'user-or-llm',
  description: 'ID of the user adding the thread; defaults to the connected user',
} as const

export const CREATED_THREAD_OUTPUTS = {
  conversationId: { type: 'number', description: 'Conversation ID', nullable: true },
  threadId: { type: 'number', description: 'ID of the new thread', nullable: true },
} as const satisfies Record<string, OutputProperty>

const CUSTOMER_GENDERS = new Set(['male', 'female', 'unknown'])

/** Profile fields shared by Create Customer and Update Customer, with Help Scout's length limits. */
const CUSTOMER_PROFILE_LIMITS = {
  firstName: 40,
  lastName: 40,
  jobTitle: 60,
  location: 60,
  background: 200,
  photoUrl: 200,
} as const

const CUSTOMER_PROFILE_FIELDS = [
  'firstName',
  'lastName',
  'jobTitle',
  'location',
  'background',
  'age',
  'gender',
  'photoUrl',
] as const

type CustomerProfileField = (typeof CUSTOMER_PROFILE_FIELDS)[number]

/** Trimmed, validated profile values that were supplied, keyed by Help Scout field name. */
export function collectCustomerProfile(
  params: Partial<Record<CustomerProfileField, string>>
): Partial<Record<CustomerProfileField, string>> {
  const profile: Partial<Record<CustomerProfileField, string>> = {}
  for (const field of CUSTOMER_PROFILE_FIELDS) {
    const value = params[field]?.trim()
    if (!value) continue
    const limit = CUSTOMER_PROFILE_LIMITS[field as keyof typeof CUSTOMER_PROFILE_LIMITS]
    if (limit !== undefined && value.length > limit) {
      throw new Error(`${field} must be ${limit} characters or fewer`)
    }
    if (field === 'gender' && !CUSTOMER_GENDERS.has(value)) {
      throw new Error('gender must be male, female, or unknown')
    }
    profile[field] = value
  }
  return profile
}

export const CUSTOMER_PROFILE_PARAMS = {
  firstName: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'First name (up to 40 characters)',
  },
  lastName: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Last name (up to 40 characters)',
  },
  jobTitle: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Job title (up to 60 characters)',
  },
  location: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Location (up to 60 characters)',
  },
  background: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Notes about the customer (up to 200 characters)',
  },
  age: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Age, e.g. 30-35',
  },
  gender: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'male, female, or unknown',
  },
  photoUrl: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Photo URL (up to 200 characters)',
  },
} as const
