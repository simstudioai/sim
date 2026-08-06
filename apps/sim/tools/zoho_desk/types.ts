import type { ToolOutputProperty, ToolResponse } from '@/tools/types'

/**
 * Params shared by every Zoho Desk tool. `accessToken` and `apiDomain` are
 * injected server-side from the stored OAuth credential; `orgId` identifies the
 * Zoho Desk organization (portal) and is sent as a header on every request.
 */
export interface ZohoDeskBaseParams {
  accessToken: string
  apiDomain?: string
  orgId: string
}

export interface ZohoDeskListTicketsParams extends ZohoDeskBaseParams {
  from?: number
  limit?: number
  /** Comma-separated department IDs. Zoho names this query param plural. */
  departmentIds?: string
  status?: string
  priority?: string
  assignee?: string
  channel?: string
  receivedInDays?: number
  sortBy?: string
  include?: string
}

export interface ZohoDeskGetTicketParams extends ZohoDeskBaseParams {
  ticketId: string
  include?: string
}

export interface ZohoDeskUpdateTicketParams extends ZohoDeskBaseParams {
  ticketId: string
  subject?: string
  status?: string
  priority?: string
  assigneeId?: string
  departmentId?: string
  category?: string
  subCategory?: string
  dueDate?: string
  description?: string
  resolution?: string
  classification?: string
  customFields?: Record<string, unknown>
}

export interface ZohoDeskListCommentsParams extends ZohoDeskBaseParams {
  ticketId: string
  from?: number
  limit?: number
  sortBy?: string
}

export interface ZohoDeskAddCommentParams extends ZohoDeskBaseParams {
  ticketId: string
  content: string
  contentType?: string
  isPublic?: boolean
}

export interface ZohoDeskListThreadsParams extends ZohoDeskBaseParams {
  ticketId: string
  from?: number
  limit?: number
  sortBy?: string
}

export interface ZohoDeskGetThreadParams extends ZohoDeskBaseParams {
  ticketId: string
  threadId: string
  include?: string
}

export interface ZohoDeskGetContactParams extends ZohoDeskBaseParams {
  contactId: string
  include?: string
}

export type ZohoDeskListOrganizationsParams = Pick<ZohoDeskBaseParams, 'accessToken' | 'apiDomain'>

export interface ZohoDeskGetAttachmentParams extends ZohoDeskBaseParams {
  href: string
  fileName?: string
}

export interface ZohoDeskResponse extends ToolResponse {
  output: Record<string, unknown>
}

/** Attachment metadata surfaced on comment/thread outputs (not the file bytes). */
export const ZOHO_DESK_ATTACHMENT_PROPERTIES: Record<string, ToolOutputProperty> = {
  id: { type: 'string', description: 'Attachment ID' },
  name: { type: 'string', description: 'File name', optional: true },
  // Zoho documents this as KB, but serializes it as a string and its samples are
  // not self-consistent about the unit — report it as Zoho gives it rather than
  // asserting a unit we would be guessing at.
  size: { type: 'string', description: 'File size as reported by Zoho', optional: true },
  href: { type: 'string', description: 'Download href', optional: true },
}

export const ZOHO_DESK_TICKET_PROPERTIES: Record<string, ToolOutputProperty> = {
  id: { type: 'string', description: 'Ticket ID' },
  ticketNumber: { type: 'string', description: 'Human-readable ticket number', optional: true },
  subject: { type: 'string', description: 'Ticket subject', optional: true },
  description: {
    type: 'string',
    description: 'Ticket description (raw; may be HTML)',
    optional: true,
    nullable: true,
  },
  descriptionText: {
    type: 'string',
    description:
      'Plain-text rendering of the description: HTML stripped when the body contains markup, otherwise the description verbatim',
    optional: true,
    nullable: true,
  },
  status: { type: 'string', description: 'Ticket status', optional: true },
  statusType: {
    type: 'string',
    description: 'Status category (Open/Closed/On Hold)',
    optional: true,
  },
  priority: { type: 'string', description: 'Ticket priority', optional: true, nullable: true },
  category: { type: 'string', description: 'Ticket category', optional: true, nullable: true },
  subCategory: {
    type: 'string',
    description: 'Ticket sub-category',
    optional: true,
    nullable: true,
  },
  classification: {
    type: 'string',
    description: 'Ticket classification',
    optional: true,
    nullable: true,
  },
  channel: { type: 'string', description: 'Origin channel', optional: true },
  departmentId: { type: 'string', description: 'Department ID', optional: true },
  contactId: { type: 'string', description: 'Contact ID', optional: true, nullable: true },
  accountId: { type: 'string', description: 'Account ID', optional: true, nullable: true },
  assigneeId: { type: 'string', description: 'Assignee ID', optional: true, nullable: true },
  email: { type: 'string', description: 'Contact email', optional: true, nullable: true },
  phone: { type: 'string', description: 'Contact phone', optional: true, nullable: true },
  dueDate: { type: 'string', description: 'Due date', optional: true, nullable: true },
  responseDueDate: {
    type: 'string',
    description: 'Response due date',
    optional: true,
    nullable: true,
  },
  createdTime: { type: 'string', description: 'Created timestamp', optional: true },
  modifiedTime: { type: 'string', description: 'Last modified timestamp', optional: true },
  customerResponseTime: {
    type: 'string',
    description: 'Time the last customer response was received',
    optional: true,
    nullable: true,
  },
  closedTime: { type: 'string', description: 'Closed timestamp', optional: true, nullable: true },
  resolution: { type: 'string', description: 'Resolution text', optional: true, nullable: true },
  threadCount: { type: 'string', description: 'Number of threads', optional: true },
  commentCount: { type: 'string', description: 'Number of comments', optional: true },
  webUrl: { type: 'string', description: 'Web URL to the ticket', optional: true },
  isEscalated: { type: 'boolean', description: 'Whether the ticket is escalated', optional: true },
  isOverDue: { type: 'boolean', description: 'Whether the ticket is overdue', optional: true },
  isSpam: { type: 'boolean', description: 'Whether the ticket is marked spam', optional: true },
  cf: {
    type: 'json',
    description: 'Custom field values, keyed by custom field API name',
    optional: true,
  },
}

export const ZOHO_DESK_COMMENT_PROPERTIES: Record<string, ToolOutputProperty> = {
  id: { type: 'string', description: 'Comment ID' },
  content: { type: 'string', description: 'Comment content (raw; may be HTML)', optional: true },
  contentType: { type: 'string', description: 'Content type (plainText/html)', optional: true },
  contentText: {
    type: 'string',
    description: 'Plain-text rendering of content (HTML stripped when contentType is html)',
    optional: true,
  },
  isPublic: { type: 'boolean', description: 'Whether the comment is public', optional: true },
  commenterId: { type: 'string', description: 'Commenter ID', optional: true },
  commenter: {
    type: 'object',
    description: 'Who wrote the comment',
    optional: true,
    properties: {
      name: { type: 'string', description: 'Display name', optional: true },
      firstName: { type: 'string', description: 'First name', optional: true },
      lastName: { type: 'string', description: 'Last name', optional: true },
      email: { type: 'string', description: 'Email address', optional: true },
      type: { type: 'string', description: 'Commenter type (AGENT/END_USER)', optional: true },
      roleName: { type: 'string', description: 'Role name', optional: true },
      photoURL: { type: 'string', description: 'Avatar URL', optional: true, nullable: true },
    },
  },
  commentedTime: { type: 'string', description: 'Commented timestamp', optional: true },
  modifiedTime: {
    type: 'string',
    description: 'Modified timestamp',
    optional: true,
    nullable: true,
  },
  attachments: {
    type: 'array',
    description: 'Comment attachments',
    optional: true,
    items: { type: 'object', properties: ZOHO_DESK_ATTACHMENT_PROPERTIES },
  },
}

export const ZOHO_DESK_THREAD_PROPERTIES: Record<string, ToolOutputProperty> = {
  id: { type: 'string', description: 'Thread ID' },
  channel: { type: 'string', description: 'Thread channel', optional: true },
  direction: { type: 'string', description: 'Direction (in/out)', optional: true },
  content: {
    type: 'string',
    description: 'Thread content (raw; may be HTML)',
    optional: true,
    nullable: true,
  },
  contentType: { type: 'string', description: 'Content type', optional: true },
  contentText: {
    type: 'string',
    description: 'Plain-text rendering of content (HTML stripped when contentType is html)',
    optional: true,
    nullable: true,
  },
  summary: { type: 'string', description: 'Thread summary', optional: true, nullable: true },
  responderId: { type: 'string', description: 'Responder ID', optional: true, nullable: true },
  createdTime: { type: 'string', description: 'Created timestamp', optional: true },
  hasAttach: { type: 'boolean', description: 'Whether the thread has attachments', optional: true },
  attachmentCount: { type: 'string', description: 'Number of attachments', optional: true },
  fromEmailAddress: {
    type: 'string',
    description: 'From email address',
    optional: true,
    nullable: true,
  },
  to: { type: 'string', description: 'To email address', optional: true, nullable: true },
  cc: { type: 'string', description: 'CC email address', optional: true, nullable: true },
  bcc: { type: 'string', description: 'BCC email address', optional: true, nullable: true },
  replyTo: {
    type: 'string',
    description: 'Reply-to email address',
    optional: true,
    nullable: true,
  },
  isForward: { type: 'boolean', description: 'Whether the thread is a forward', optional: true },
  isContentTruncated: {
    type: 'boolean',
    description: 'Whether Zoho truncated the thread content; fetch fullContentURL for the rest',
    optional: true,
  },
  fullContentURL: {
    type: 'string',
    description: 'URL returning the untruncated thread content',
    optional: true,
    nullable: true,
  },
  plainText: {
    type: 'string',
    description: "Zoho's own plain-text rendering of the thread, when it supplies one",
    optional: true,
    nullable: true,
  },
  status: {
    type: 'string',
    description: 'Delivery status of the thread (e.g. SUCCESS, PENDING, FAILED, DRAFT)',
    optional: true,
  },
  isDescriptionThread: {
    type: 'boolean',
    description: "Whether this thread is the ticket's original description",
    optional: true,
  },
  visibility: { type: 'string', description: 'Thread visibility (e.g. public)', optional: true },
  canReply: {
    type: 'boolean',
    description: 'Whether the thread can be replied to',
    optional: true,
  },
  author: {
    type: 'object',
    description: 'Who sent the thread',
    optional: true,
    properties: {
      name: { type: 'string', description: 'Display name', optional: true },
      firstName: { type: 'string', description: 'First name', optional: true },
      lastName: { type: 'string', description: 'Last name', optional: true },
      email: { type: 'string', description: 'Email address', optional: true },
      type: { type: 'string', description: 'Author type (AGENT/END_USER)', optional: true },
      photoURL: { type: 'string', description: 'Avatar URL', optional: true, nullable: true },
    },
  },
  attachments: {
    type: 'array',
    description: 'Thread attachments',
    optional: true,
    items: { type: 'object', properties: ZOHO_DESK_ATTACHMENT_PROPERTIES },
  },
}

export const ZOHO_DESK_CONTACT_PROPERTIES: Record<string, ToolOutputProperty> = {
  id: { type: 'string', description: 'Contact ID' },
  firstName: { type: 'string', description: 'First name', optional: true, nullable: true },
  lastName: { type: 'string', description: 'Last name', optional: true },
  email: { type: 'string', description: 'Primary email', optional: true, nullable: true },
  secondaryEmail: {
    type: 'string',
    description: 'Secondary email',
    optional: true,
    nullable: true,
  },
  phone: { type: 'string', description: 'Phone number', optional: true, nullable: true },
  mobile: { type: 'string', description: 'Mobile number', optional: true, nullable: true },
  accountId: {
    type: 'string',
    description: 'Associated account ID',
    optional: true,
    nullable: true,
  },
  ownerId: { type: 'string', description: 'Owner ID', optional: true, nullable: true },
  type: { type: 'string', description: 'Contact type', optional: true, nullable: true },
  title: { type: 'string', description: 'Job title', optional: true, nullable: true },
  street: { type: 'string', description: 'Street', optional: true, nullable: true },
  city: { type: 'string', description: 'City', optional: true, nullable: true },
  state: { type: 'string', description: 'State', optional: true, nullable: true },
  country: { type: 'string', description: 'Country', optional: true, nullable: true },
  zip: { type: 'string', description: 'ZIP / postal code', optional: true, nullable: true },
  description: { type: 'string', description: 'Description', optional: true, nullable: true },
  cf: {
    type: 'json',
    description: 'Custom field values, keyed by custom field API name',
    optional: true,
  },
}
