import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Which Mailtrap sending stream a message is routed through. Each stream is a
 * separate host with its own API token scope:
 *  - `transactional` -> https://send.api.mailtrap.io
 *  - `bulk`          -> https://bulk.api.mailtrap.io
 *  - `sandbox`       -> https://sandbox.api.mailtrap.io (needs a sandbox id)
 */
export type MailtrapSendStream = 'transactional' | 'bulk' | 'sandbox'

/** Send Email */
export interface MailtrapSendEmailParams {
  apiToken: string
  stream?: MailtrapSendStream
  sandboxId?: string
  from: string
  to?: string
  cc?: string
  bcc?: string
  replyTo?: string
  subject: string
  text?: string
  html?: string
  category?: string
  customVariables?: Record<string, string> | string
  emailHeaders?: Record<string, string> | string
  templateUuid?: string
  templateVariables?: Record<string, unknown> | string
}

export interface MailtrapSendEmailResult extends ToolResponse {
  output: {
    success: boolean
    messageIds: string[]
  }
}

/** Shape of a single contact record returned by the Contacts API. */
export interface MailtrapContact {
  id: string
  email: string
  fields: Record<string, unknown>
  listIds: number[]
  status: 'subscribed' | 'unsubscribed' | string
  createdAt: number
  updatedAt: number
}

/** Create Contact */
export interface MailtrapCreateContactParams {
  apiToken: string
  email: string
  fields?: Record<string, unknown> | string
  listIds?: string
}

export interface MailtrapCreateContactResult extends ToolResponse {
  output: {
    contact: MailtrapContact
  }
}

/** Get Contact */
export interface MailtrapGetContactParams {
  apiToken: string
  contactIdentifier: string
}

export interface MailtrapGetContactResult extends ToolResponse {
  output: {
    contact: MailtrapContact
  }
}

/** Update Contact */
export interface MailtrapUpdateContactParams {
  apiToken: string
  contactIdentifier: string
  email: string
  fields?: Record<string, unknown> | string
  listIdsIncluded?: string
  listIdsExcluded?: string
  unsubscribed?: boolean
}

export interface MailtrapUpdateContactResult extends ToolResponse {
  output: {
    action: 'created' | 'updated' | string
    contact: MailtrapContact
  }
}

/** Delete Contact */
export interface MailtrapDeleteContactParams {
  apiToken: string
  contactIdentifier: string
}

export interface MailtrapDeleteContactResult extends ToolResponse {
  output: {
    success: boolean
    deleted: boolean
  }
}

/** A Mailtrap contact list. */
export interface MailtrapContactList {
  id: number
  name: string
}

/** List Contact Lists */
export interface MailtrapListContactListsParams {
  apiToken: string
  search?: string
}

export interface MailtrapListContactListsResult extends ToolResponse {
  output: {
    lists: MailtrapContactList[]
  }
}

/** Create Contact List */
export interface MailtrapCreateContactListParams {
  apiToken: string
  name: string
}

export interface MailtrapContactListResult extends ToolResponse {
  output: {
    list: MailtrapContactList
  }
}

/** Get Contact List */
export interface MailtrapGetContactListParams {
  apiToken: string
  listId: string
}

/** Update Contact List */
export interface MailtrapUpdateContactListParams {
  apiToken: string
  listId: string
  name: string
}

/** Delete Contact List */
export interface MailtrapDeleteContactListParams {
  apiToken: string
  listId: string
}

export interface MailtrapDeleteContactListResult extends ToolResponse {
  output: {
    success: boolean
    deleted: boolean
  }
}

/** A message row from the Email Logs API. */
export interface MailtrapSendingMessage {
  messageId: string
  status: 'delivered' | 'not_delivered' | 'enqueued' | 'opted_out' | string
  subject: string | null
  from: string
  to: string
  sentAt: string
  clientIp: string | null
  category: string | null
  customVariables: Record<string, unknown>
  sendingStream: 'transactional' | 'bulk' | string
  domainId: number
  templateId: number | null
  templateVariables: Record<string, unknown>
  opensCount: number
  clicksCount: number
  rfcMessageId: string | null
  inReplyTo: string | null
  references: string[]
  threadId: string | null
}

/** The single-message view adds the raw download URL and the event timeline. */
export interface MailtrapSendingMessageDetail extends MailtrapSendingMessage {
  rawMessageUrl: string | null
  events: Array<Record<string, unknown>>
}

/** List Email Logs */

/** How the Email Logs `subject` filter is matched. */
export type MailtrapSubjectMatch = 'contain' | 'equal' | 'empty'

export interface MailtrapListEmailLogsParams {
  apiToken: string
  sentAfter?: string
  sentBefore?: string
  to?: string
  fromAddress?: string
  subject?: string
  /** Match operator for `subject`. Defaults to `contain` when omitted. */
  subjectMatch?: MailtrapSubjectMatch
  /** Comma-separated; each value is sent as an array entry (`equal` operator). */
  status?: string
  /** Comma-separated; each value is sent as an array entry (`equal` operator). */
  category?: string
  /** Comma-separated; each value is sent as an array entry (`equal` operator). */
  sendingStream?: string
  searchAfter?: string
}

export interface MailtrapListEmailLogsResult extends ToolResponse {
  output: {
    messages: MailtrapSendingMessage[]
    totalCount: number
    nextPageCursor: string | null
  }
}

/** Get Email Log */
export interface MailtrapGetEmailLogParams {
  apiToken: string
  messageId: string
}

export interface MailtrapGetEmailLogResult extends ToolResponse {
  output: {
    message: MailtrapSendingMessageDetail
  }
}

/**
 * Shared tool `outputs` shapes.
 * Every contact tool projects the same {@link MailtrapContact},
 * every contact-list tool the same {@link MailtrapContactList},
 * and both email-logs tools the same {@link MailtrapSendingMessage},
 * so the schema is declared once here and referenced from each tool's `outputs`.
 */
export const MAILTRAP_CONTACT_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Contact id (UUID)' },
  email: { type: 'string', description: 'Contact email address' },
  fields: { type: 'json', description: 'Contact field values keyed by merge tag' },
  listIds: { type: 'array', description: 'Ids of the lists the contact belongs to' },
  status: { type: 'string', description: 'Subscription status: subscribed or unsubscribed' },
  createdAt: { type: 'number', description: 'Creation time in epoch milliseconds' },
  updatedAt: { type: 'number', description: 'Last update time in epoch milliseconds' },
} as const satisfies Record<string, OutputProperty>

export const MAILTRAP_CONTACT_LIST_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'Contact list id' },
  name: { type: 'string', description: 'Contact list name' },
} as const satisfies Record<string, OutputProperty>

export const MAILTRAP_SENDING_MESSAGE_OUTPUT_PROPERTIES = {
  messageId: { type: 'string', description: 'Message UUID' },
  status: { type: 'string', description: 'delivered, not_delivered, enqueued, opted_out' },
  subject: { type: 'string', description: 'Subject line', nullable: true },
  from: { type: 'string', description: 'Sender address' },
  to: { type: 'string', description: 'Recipient address' },
  sentAt: { type: 'string', description: 'Send time (ISO 8601)' },
  clientIp: { type: 'string', description: 'Client IP the send came from', nullable: true },
  category: { type: 'string', description: 'Category label', nullable: true },
  customVariables: { type: 'json', description: 'Custom variables attached to the message' },
  sendingStream: { type: 'string', description: 'transactional or bulk' },
  domainId: { type: 'number', description: 'Sending domain id' },
  templateId: {
    type: 'number',
    description: 'Template id, if a template was used',
    nullable: true,
  },
  templateVariables: { type: 'json', description: 'Template variables' },
  opensCount: { type: 'number', description: 'Number of opens' },
  clicksCount: { type: 'number', description: 'Number of clicks' },
  rfcMessageId: { type: 'string', description: 'RFC 5322 Message-ID header', nullable: true },
  inReplyTo: { type: 'string', description: 'RFC 5322 In-Reply-To header', nullable: true },
  references: { type: 'array', description: 'RFC 5322 References header values' },
  threadId: { type: 'string', description: 'Inbound thread id, if any', nullable: true },
} as const satisfies Record<string, OutputProperty>

export const MAILTRAP_SENDING_MESSAGE_DETAIL_OUTPUT_PROPERTIES = {
  ...MAILTRAP_SENDING_MESSAGE_OUTPUT_PROPERTIES,
  rawMessageUrl: {
    type: 'string',
    description: 'Temporary signed URL to download the raw .eml',
    nullable: true,
  },
  events: {
    type: 'json',
    description:
      'Event timeline. Each entry has event_type, created_at, and a type-specific details object',
  },
} as const satisfies Record<string, OutputProperty>
