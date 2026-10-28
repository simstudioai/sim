import type { OutputProperty, ToolResponse } from '@/tools/types'

export interface HelpScoutPerson {
  id: number | null
  type: string | null
  first: string | null
  last: string | null
  name: string | null
  email: string | null
}

interface HelpScoutConversationTag {
  id: number | null
  tag: string | null
  color: string | null
}

interface HelpScoutConversationCustomField {
  id: number | null
  name: string | null
  value: string | null
  text: string | null
}

export interface HelpScoutConversation {
  id: number | null
  number: number | null
  threadCount: number | null
  type: string | null
  folderId: number | null
  status: string | null
  state: string | null
  subject: string | null
  preview: string | null
  mailboxId: number | null
  assignee: HelpScoutPerson | null
  createdBy: HelpScoutPerson | null
  primaryCustomer: HelpScoutPerson | null
  createdAt: string | null
  closedAt: string | null
  closedBy: number | null
  userUpdatedAt: string | null
  customerWaitingSince: string | null
  sourceType: string | null
  sourceVia: string | null
  tags: HelpScoutConversationTag[]
  cc: string[]
  bcc: string[]
  customFields: HelpScoutConversationCustomField[]
  snoozedUntil: string | null
  webUrl: string | null
}

export interface HelpScoutAttachment {
  id: number | null
  filename: string | null
  mimeType: string | null
  size: number | null
  state: string | null
}

export interface HelpScoutThread {
  id: number | null
  type: string | null
  status: string | null
  state: string | null
  body: string | null
  sourceType: string | null
  sourceVia: string | null
  customer: HelpScoutPerson | null
  createdBy: HelpScoutPerson | null
  assignedTo: HelpScoutPerson | null
  to: string[]
  cc: string[]
  bcc: string[]
  createdAt: string | null
  openedAt: string | null
  savedReplyId: number | null
  attachments: HelpScoutAttachment[]
}

export interface HelpScoutCustomerEntry {
  id: number | null
  value: string | null
  type: string | null
}

interface HelpScoutCustomerProperty {
  slug: string | null
  name: string | null
  type: string | null
  value: string | null
  text: string | null
}

export interface HelpScoutCustomer {
  id: number | null
  firstName: string | null
  lastName: string | null
  gender: string | null
  jobTitle: string | null
  location: string | null
  organization: string | null
  organizationId: number | null
  photoType: string | null
  photoUrl: string | null
  age: string | null
  background: string | null
  conversationCount: number | null
  draft: boolean | null
  createdAt: string | null
  updatedAt: string | null
  emails: HelpScoutCustomerEntry[]
  phones: HelpScoutCustomerEntry[]
  websites: HelpScoutCustomerEntry[]
  socialProfiles: HelpScoutCustomerEntry[]
  chats: HelpScoutCustomerEntry[]
  properties: HelpScoutCustomerProperty[]
}

export interface HelpScoutMailbox {
  id: number | null
  name: string | null
  slug: string | null
  email: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface HelpScoutFolder {
  id: number | null
  name: string | null
  type: string | null
  userId: number | null
  totalCount: number | null
  activeCount: number | null
  updatedAt: string | null
}

export interface HelpScoutUser {
  id: number | null
  firstName: string | null
  lastName: string | null
  email: string | null
  role: string | null
  timezone: string | null
  photoUrl: string | null
  type: string | null
  mention: string | null
  initials: string | null
  jobTitle: string | null
  phone: string | null
  alternateEmails: string[]
  createdAt: string | null
  updatedAt: string | null
}

export interface HelpScoutTag {
  id: number | null
  name: string | null
  slug: string | null
  ticketCount: number | null
  createdAt: string | null
  updatedAt: string | null
}

export interface HelpScoutTeam {
  id: number | null
  name: string | null
  mention: string | null
  initials: string | null
  timezone: string | null
  photoUrl: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface HelpScoutWorkflow {
  id: number | null
  mailboxId: number | null
  type: string | null
  status: string | null
  order: number | null
  name: string | null
  createdAt: string | null
  modifiedAt: string | null
}

export interface HelpScoutPage {
  number: number | null
  size: number | null
  totalElements: number | null
  totalPages: number | null
}

const PERSON_PROPERTIES = {
  id: { type: 'number', description: 'User, team, or customer ID', nullable: true },
  type: { type: 'string', description: 'user, team, or customer', nullable: true },
  first: { type: 'string', description: 'First name', nullable: true },
  last: { type: 'string', description: 'Last name', nullable: true },
  name: { type: 'string', description: 'Team name, when the person is a team', nullable: true },
  email: { type: 'string', description: 'Email address', nullable: true },
} as const satisfies Record<string, OutputProperty>

export const HELPSCOUT_PAGE_PROPERTIES = {
  number: { type: 'number', description: 'Current page number', nullable: true },
  size: { type: 'number', description: 'Results per page', nullable: true },
  totalElements: { type: 'number', description: 'Total matching results', nullable: true },
  totalPages: { type: 'number', description: 'Total number of pages', nullable: true },
} as const satisfies Record<string, OutputProperty>

export const HELPSCOUT_CONVERSATION_PROPERTIES = {
  id: { type: 'number', description: 'Conversation ID', nullable: true },
  number: {
    type: 'number',
    description: 'Conversation number shown in Help Scout',
    nullable: true,
  },
  threadCount: {
    type: 'number',
    description: 'Number of published threads, excluding notes',
    nullable: true,
  },
  type: { type: 'string', description: 'email, chat, or phone', nullable: true },
  folderId: { type: 'number', description: 'Folder ID', nullable: true },
  status: {
    type: 'string',
    description: 'active, pending, closed, or spam',
    nullable: true,
  },
  state: { type: 'string', description: 'published, draft, or deleted', nullable: true },
  subject: { type: 'string', description: 'Subject', nullable: true },
  preview: {
    type: 'string',
    description: 'Preview text from the most recent thread',
    nullable: true,
  },
  mailboxId: { type: 'number', description: 'Inbox ID', nullable: true },
  assignee: {
    type: 'json',
    description: 'User or team the conversation is assigned to',
    nullable: true,
    properties: PERSON_PROPERTIES,
  },
  createdBy: {
    type: 'json',
    description: 'User or customer who created the conversation',
    nullable: true,
    properties: PERSON_PROPERTIES,
  },
  primaryCustomer: {
    type: 'json',
    description: 'Primary customer of the conversation',
    nullable: true,
    properties: PERSON_PROPERTIES,
  },
  createdAt: { type: 'string', description: 'When the conversation was created', nullable: true },
  closedAt: { type: 'string', description: 'When the conversation was closed', nullable: true },
  closedBy: { type: 'number', description: 'ID of the user who closed it', nullable: true },
  userUpdatedAt: {
    type: 'string',
    description: 'When a user last updated the conversation',
    nullable: true,
  },
  customerWaitingSince: {
    type: 'string',
    description: 'When the customer started waiting for a reply',
    nullable: true,
  },
  sourceType: {
    type: 'string',
    description: 'Originating channel (email, beacon, api, and others)',
    nullable: true,
  },
  sourceVia: { type: 'string', description: 'user or customer', nullable: true },
  tags: {
    type: 'array',
    description: 'Tags on the conversation',
    items: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Tag ID', nullable: true },
        tag: { type: 'string', description: 'Tag name', nullable: true },
        color: { type: 'string', description: 'Tag color', nullable: true },
      },
    },
  },
  cc: { type: 'array', description: 'CC email addresses', items: { type: 'string' } },
  bcc: { type: 'array', description: 'BCC email addresses', items: { type: 'string' } },
  customFields: {
    type: 'array',
    description: 'Custom field values',
    items: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Custom field ID', nullable: true },
        name: { type: 'string', description: 'Custom field name', nullable: true },
        value: {
          type: 'string',
          description: 'Stored value (the option ID for dropdowns)',
          nullable: true,
        },
        text: { type: 'string', description: 'Display text', nullable: true },
      },
    },
  },
  snoozedUntil: {
    type: 'string',
    description: 'When the snooze ends, if the conversation is snoozed',
    nullable: true,
  },
  webUrl: {
    type: 'string',
    description: 'Link to the conversation in Help Scout',
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>

export const HELPSCOUT_THREAD_PROPERTIES = {
  id: { type: 'number', description: 'Thread ID', nullable: true },
  type: {
    type: 'string',
    description: 'customer, message, note, chat, phone, lineitem, and others',
    nullable: true,
  },
  status: { type: 'string', description: 'Conversation status set by the thread', nullable: true },
  state: {
    type: 'string',
    description: 'published, draft, hidden, bounced, or review',
    nullable: true,
  },
  body: { type: 'string', description: 'Thread content', nullable: true },
  sourceType: { type: 'string', description: 'Originating channel', nullable: true },
  sourceVia: { type: 'string', description: 'user or customer', nullable: true },
  customer: {
    type: 'json',
    description: 'Customer associated with the thread',
    nullable: true,
    properties: PERSON_PROPERTIES,
  },
  createdBy: {
    type: 'json',
    description: 'User or customer who created the thread',
    nullable: true,
    properties: PERSON_PROPERTIES,
  },
  assignedTo: {
    type: 'json',
    description: 'User or team assigned by the thread',
    nullable: true,
    properties: PERSON_PROPERTIES,
  },
  to: { type: 'array', description: 'To email addresses', items: { type: 'string' } },
  cc: { type: 'array', description: 'CC email addresses', items: { type: 'string' } },
  bcc: { type: 'array', description: 'BCC email addresses', items: { type: 'string' } },
  createdAt: { type: 'string', description: 'When the thread was created', nullable: true },
  openedAt: {
    type: 'string',
    description: 'When the customer viewed the reply',
    nullable: true,
  },
  savedReplyId: {
    type: 'number',
    description: 'ID of the saved reply used for the thread',
    nullable: true,
  },
  attachments: {
    type: 'array',
    description: 'Attachments on the thread',
    items: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Attachment ID', nullable: true },
        filename: { type: 'string', description: 'File name', nullable: true },
        mimeType: { type: 'string', description: 'MIME type', nullable: true },
        size: { type: 'number', description: 'Size in bytes', nullable: true },
        state: { type: 'string', description: 'valid or virus', nullable: true },
      },
    },
  },
} as const satisfies Record<string, OutputProperty>

const CUSTOMER_ENTRY_ITEM = {
  type: 'object',
  properties: {
    id: { type: 'number', description: 'Entry ID', nullable: true },
    value: { type: 'string', description: 'Entry value', nullable: true },
    type: { type: 'string', description: 'Entry type', nullable: true },
  },
} as const

export const HELPSCOUT_CUSTOMER_PROPERTIES = {
  id: { type: 'number', description: 'Customer ID', nullable: true },
  firstName: { type: 'string', description: 'First name', nullable: true },
  lastName: { type: 'string', description: 'Last name', nullable: true },
  gender: { type: 'string', description: 'Gender', nullable: true },
  jobTitle: { type: 'string', description: 'Job title', nullable: true },
  location: { type: 'string', description: 'Location', nullable: true },
  organization: { type: 'string', description: 'Organization name', nullable: true },
  organizationId: { type: 'number', description: 'Organization ID', nullable: true },
  photoType: { type: 'string', description: 'Photo source', nullable: true },
  photoUrl: { type: 'string', description: 'Photo URL', nullable: true },
  age: { type: 'string', description: 'Age', nullable: true },
  background: { type: 'string', description: 'Notes about the customer', nullable: true },
  conversationCount: {
    type: 'number',
    description: 'Number of conversations with the customer',
    nullable: true,
  },
  draft: {
    type: 'boolean',
    description: 'Whether the customer is a draft record',
    nullable: true,
  },
  createdAt: { type: 'string', description: 'When the customer was created', nullable: true },
  updatedAt: { type: 'string', description: 'When the customer was updated', nullable: true },
  emails: { type: 'array', description: 'Email addresses', items: CUSTOMER_ENTRY_ITEM },
  phones: { type: 'array', description: 'Phone numbers', items: CUSTOMER_ENTRY_ITEM },
  websites: { type: 'array', description: 'Websites', items: CUSTOMER_ENTRY_ITEM },
  socialProfiles: { type: 'array', description: 'Social profiles', items: CUSTOMER_ENTRY_ITEM },
  chats: { type: 'array', description: 'Chat handles', items: CUSTOMER_ENTRY_ITEM },
  properties: {
    type: 'array',
    description: 'Customer property values',
    items: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'Property slug', nullable: true },
        name: { type: 'string', description: 'Property name', nullable: true },
        type: { type: 'string', description: 'Property type', nullable: true },
        value: { type: 'string', description: 'Stored value', nullable: true },
        text: { type: 'string', description: 'Display text', nullable: true },
      },
    },
  },
} as const satisfies Record<string, OutputProperty>

export const HELPSCOUT_MAILBOX_PROPERTIES = {
  id: { type: 'number', description: 'Inbox ID', nullable: true },
  name: { type: 'string', description: 'Inbox name', nullable: true },
  slug: { type: 'string', description: 'Inbox slug', nullable: true },
  email: { type: 'string', description: 'Inbox email address', nullable: true },
  createdAt: { type: 'string', description: 'When the inbox was created', nullable: true },
  updatedAt: { type: 'string', description: 'When the inbox was updated', nullable: true },
} as const satisfies Record<string, OutputProperty>

export const HELPSCOUT_FOLDER_PROPERTIES = {
  id: { type: 'number', description: 'Folder ID', nullable: true },
  name: { type: 'string', description: 'Folder name', nullable: true },
  type: { type: 'string', description: 'Folder type', nullable: true },
  userId: { type: 'number', description: 'ID of the folder owner', nullable: true },
  totalCount: {
    type: 'number',
    description: 'Total conversations in the folder',
    nullable: true,
  },
  activeCount: {
    type: 'number',
    description: 'Active conversations in the folder',
    nullable: true,
  },
  updatedAt: { type: 'string', description: 'When the folder was updated', nullable: true },
} as const satisfies Record<string, OutputProperty>

export const HELPSCOUT_USER_PROPERTIES = {
  id: { type: 'number', description: 'User ID', nullable: true },
  firstName: { type: 'string', description: 'First name', nullable: true },
  lastName: { type: 'string', description: 'Last name', nullable: true },
  email: { type: 'string', description: 'Email address', nullable: true },
  role: { type: 'string', description: 'Account role', nullable: true },
  timezone: { type: 'string', description: 'Time zone', nullable: true },
  photoUrl: { type: 'string', description: 'Photo URL', nullable: true },
  type: { type: 'string', description: 'User type', nullable: true },
  mention: { type: 'string', description: 'Mention handle', nullable: true },
  initials: { type: 'string', description: 'Initials', nullable: true },
  jobTitle: { type: 'string', description: 'Job title', nullable: true },
  phone: { type: 'string', description: 'Phone number', nullable: true },
  alternateEmails: {
    type: 'array',
    description: 'Alternate email addresses',
    items: { type: 'string' },
  },
  createdAt: { type: 'string', description: 'When the user was created', nullable: true },
  updatedAt: { type: 'string', description: 'When the user was updated', nullable: true },
} as const satisfies Record<string, OutputProperty>

export const HELPSCOUT_TAG_PROPERTIES = {
  id: { type: 'number', description: 'Tag ID', nullable: true },
  name: { type: 'string', description: 'Tag name', nullable: true },
  slug: { type: 'string', description: 'Tag slug', nullable: true },
  ticketCount: {
    type: 'number',
    description: 'Number of conversations with the tag',
    nullable: true,
  },
  createdAt: { type: 'string', description: 'When the tag was created', nullable: true },
  updatedAt: { type: 'string', description: 'When the tag was updated', nullable: true },
} as const satisfies Record<string, OutputProperty>

export const HELPSCOUT_TEAM_PROPERTIES = {
  id: { type: 'number', description: 'Team ID', nullable: true },
  name: { type: 'string', description: 'Team name', nullable: true },
  mention: { type: 'string', description: 'Mention handle', nullable: true },
  initials: { type: 'string', description: 'Initials', nullable: true },
  timezone: { type: 'string', description: 'Time zone', nullable: true },
  photoUrl: { type: 'string', description: 'Photo URL', nullable: true },
  createdAt: { type: 'string', description: 'When the team was created', nullable: true },
  updatedAt: { type: 'string', description: 'When the team was updated', nullable: true },
} as const satisfies Record<string, OutputProperty>

export const HELPSCOUT_WORKFLOW_PROPERTIES = {
  id: { type: 'number', description: 'Workflow ID', nullable: true },
  mailboxId: { type: 'number', description: 'Inbox ID', nullable: true },
  type: { type: 'string', description: 'manual or automatic', nullable: true },
  status: { type: 'string', description: 'active, inactive, or invalid', nullable: true },
  order: { type: 'number', description: 'Workflow order', nullable: true },
  name: { type: 'string', description: 'Workflow name', nullable: true },
  createdAt: { type: 'string', description: 'When the workflow was created', nullable: true },
  modifiedAt: { type: 'string', description: 'When the workflow was modified', nullable: true },
} as const satisfies Record<string, OutputProperty>

export const CONVERSATION_CHANGE_OUTPUTS = {
  conversationId: {
    type: 'number',
    description: 'ID of the updated conversation',
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>

export const CREATED_THREAD_OUTPUTS = {
  conversationId: { type: 'number', description: 'Conversation ID', nullable: true },
  threadId: { type: 'number', description: 'ID of the new thread', nullable: true },
} as const satisfies Record<string, OutputProperty>

export interface HelpScoutCustomField {
  id: number | null
  name: string | null
  type: string | null
  required: boolean | null
  order: number | null
  systemType: string | null
  options: Array<{ id: number | null; label: string | null; order: number | null }>
}

export const HELPSCOUT_CUSTOM_FIELD_PROPERTIES = {
  id: { type: 'number', description: 'Custom field ID', nullable: true },
  name: { type: 'string', description: 'Custom field name', nullable: true },
  type: {
    type: 'string',
    description: 'Field type (singleline, multiline, dropdown, number, date)',
    nullable: true,
  },
  required: { type: 'boolean', description: 'Whether the field must be set', nullable: true },
  order: { type: 'number', description: 'Display order', nullable: true },
  systemType: {
    type: 'string',
    description: 'Help Scout-managed field kind (topic or sentiment), if any',
    nullable: true,
  },
  options: {
    type: 'array',
    description: 'Dropdown options; set a dropdown field to an option ID',
    items: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Option ID', nullable: true },
        label: { type: 'string', description: 'Option label', nullable: true },
        order: { type: 'number', description: 'Option order', nullable: true },
      },
    },
  },
} as const satisfies Record<string, OutputProperty>

export interface HelpScoutSavedReplySummary {
  id: number | null
  name: string | null
  preview: string | null
  chatPreview: string | null
}

export interface HelpScoutSavedReply {
  id: number | null
  name: string | null
  text: string | null
  chatText: string | null
}

export const HELPSCOUT_SAVED_REPLY_SUMMARY_PROPERTIES = {
  id: { type: 'number', description: 'Saved reply ID', nullable: true },
  name: { type: 'string', description: 'Saved reply name', nullable: true },
  preview: { type: 'string', description: 'Preview of the email text', nullable: true },
  chatPreview: { type: 'string', description: 'Preview of the chat text', nullable: true },
} as const satisfies Record<string, OutputProperty>

export const HELPSCOUT_SAVED_REPLY_PROPERTIES = {
  id: { type: 'number', description: 'Saved reply ID', nullable: true },
  name: { type: 'string', description: 'Saved reply name', nullable: true },
  text: { type: 'string', description: 'Email reply text (HTML)', nullable: true },
  chatText: { type: 'string', description: 'Chat reply text', nullable: true },
} as const satisfies Record<string, OutputProperty>

export interface HelpScoutCustomerPropertyDefinition {
  slug: string | null
  name: string | null
  type: string | null
  options: Array<{ id: string | null; label: string | null }>
}

export const HELPSCOUT_CUSTOMER_PROPERTY_DEFINITION_PROPERTIES = {
  slug: { type: 'string', description: 'Property slug used to set values', nullable: true },
  name: { type: 'string', description: 'Property name', nullable: true },
  type: {
    type: 'string',
    description: 'Value type (text, number, url, date, dropdown)',
    nullable: true,
  },
  options: {
    type: 'array',
    description: 'Dropdown options',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Option ID', nullable: true },
        label: { type: 'string', description: 'Option label', nullable: true },
      },
    },
  },
} as const satisfies Record<string, OutputProperty>

export interface HelpScoutOrganization {
  id: number | null
  name: string | null
  website: string | null
  description: string | null
  location: string | null
  logoUrl: string | null
  note: string | null
  domains: string[]
  phones: string[]
  brandColor: string | null
  customerCount: number | null
  conversationCount: number | null
  properties: Array<{
    definitionId: number | null
    slug: string | null
    name: string | null
    type: string | null
    value: string | null
    options: string[]
  }>
}

export const HELPSCOUT_ORGANIZATION_PROPERTIES = {
  id: { type: 'number', description: 'Organization ID', nullable: true },
  name: { type: 'string', description: 'Organization name', nullable: true },
  website: { type: 'string', description: 'Website', nullable: true },
  description: { type: 'string', description: 'Description', nullable: true },
  location: { type: 'string', description: 'Two-letter country code', nullable: true },
  logoUrl: { type: 'string', description: 'Logo URL', nullable: true },
  note: { type: 'string', description: 'Custom note', nullable: true },
  domains: {
    type: 'array',
    description: 'Domains used to match customers to the organization',
    items: { type: 'string' },
  },
  phones: { type: 'array', description: 'Phone numbers', items: { type: 'string' } },
  brandColor: { type: 'string', description: 'Brand color (hex)', nullable: true },
  customerCount: {
    type: 'number',
    description: 'Number of customers (when counts are included)',
    nullable: true,
  },
  conversationCount: {
    type: 'number',
    description: 'Number of conversations (when counts are included)',
    nullable: true,
  },
  properties: {
    type: 'array',
    description: 'Organization property values (when properties are included)',
    items: {
      type: 'object',
      properties: {
        definitionId: { type: 'number', description: 'Property definition ID', nullable: true },
        slug: { type: 'string', description: 'Property slug', nullable: true },
        name: { type: 'string', description: 'Property name', nullable: true },
        type: { type: 'string', description: 'Property type', nullable: true },
        value: { type: 'string', description: 'Property value', nullable: true },
        options: {
          type: 'array',
          description: 'Option labels (dropdown properties)',
          items: { type: 'string' },
        },
      },
    },
  },
} as const satisfies Record<string, OutputProperty>

interface HelpScoutAuthParams {
  accessToken: string
}

interface HelpScoutPageParams {
  page?: number
}

interface HelpScoutListOutput {
  page: HelpScoutPage
  nextPage: number | null
}

export interface HelpScoutListConversationsParams extends HelpScoutAuthParams, HelpScoutPageParams {
  mailboxId?: string
  folderId?: string
  status?: string
  tag?: string
  assignedTo?: string
  modifiedSince?: string
  number?: number
  sortField?: string
  sortOrder?: string
  query?: string
}

export interface HelpScoutListConversationsResponse extends ToolResponse {
  output: HelpScoutListOutput & { conversations: HelpScoutConversation[] }
}

export interface HelpScoutGetConversationParams extends HelpScoutAuthParams {
  conversationId: string
  includeThreads?: boolean
}

export interface HelpScoutGetConversationResponse extends ToolResponse {
  output: { conversation: HelpScoutConversation; threads: HelpScoutThread[] }
}

export interface HelpScoutCreateConversationParams extends HelpScoutAuthParams {
  subject: string
  mailboxId: string
  type?: string
  status?: string
  customerId?: string
  customerEmail?: string
  customerFirstName?: string
  customerLastName?: string
  threadType?: string
  text: string
  assignTo?: string
  tags?: string | string[]
  autoReply?: boolean
  userId?: string
}

export interface HelpScoutCreateConversationResponse extends ToolResponse {
  output: { id: number | null; webUrl: string | null }
}

interface HelpScoutConversationParams extends HelpScoutAuthParams {
  conversationId: string
}

export interface HelpScoutUpdateConversationStatusParams extends HelpScoutConversationParams {
  status: string
}

export interface HelpScoutUpdateConversationSubjectParams extends HelpScoutConversationParams {
  subject: string
}

export interface HelpScoutAssignConversationParams extends HelpScoutConversationParams {
  assignTo: string
}

export type HelpScoutUnassignConversationParams = HelpScoutConversationParams

export interface HelpScoutMoveConversationParams extends HelpScoutConversationParams {
  mailboxId: string
}

export type HelpScoutDeleteConversationParams = HelpScoutConversationParams

export interface HelpScoutSetConversationTagsParams extends HelpScoutConversationParams {
  tags: string | string[]
}

export interface HelpScoutConversationChangeResponse extends ToolResponse {
  output: { conversationId: number | null }
}

export interface HelpScoutListThreadsParams
  extends HelpScoutConversationParams,
    HelpScoutPageParams {}

export interface HelpScoutListThreadsResponse extends ToolResponse {
  output: HelpScoutListOutput & { threads: HelpScoutThread[] }
}

export interface HelpScoutCreateReplyParams extends HelpScoutConversationParams {
  customerId: string
  text: string
  draft?: boolean
  status?: string
  assignTo?: string
  cc?: string | string[]
  bcc?: string | string[]
  userId?: string
}

export interface HelpScoutCreateNoteParams extends HelpScoutConversationParams {
  text: string
  status?: string
  userId?: string
}

export interface HelpScoutCreateThreadResponse extends ToolResponse {
  output: { conversationId: number | null; threadId: number | null }
}

export interface HelpScoutListCustomersParams extends HelpScoutAuthParams, HelpScoutPageParams {
  mailboxId?: string
  firstName?: string
  lastName?: string
  modifiedSince?: string
  sortField?: string
  sortOrder?: string
  query?: string
}

export interface HelpScoutListCustomersResponse extends ToolResponse {
  output: HelpScoutListOutput & { customers: HelpScoutCustomer[] }
}

export interface HelpScoutGetCustomerParams extends HelpScoutAuthParams {
  customerId: string
}

export interface HelpScoutGetCustomerResponse extends ToolResponse {
  output: { customer: HelpScoutCustomer }
}

interface HelpScoutCustomerProfileParams {
  firstName?: string
  lastName?: string
  jobTitle?: string
  location?: string
  background?: string
  age?: string
  gender?: string
  photoUrl?: string
}

export interface HelpScoutCreateCustomerParams
  extends HelpScoutAuthParams,
    HelpScoutCustomerProfileParams {
  email?: string
  emailType?: string
  phone?: string
  phoneType?: string
  organizationId?: string
}

export interface HelpScoutCreateCustomerResponse extends ToolResponse {
  output: { id: number | null }
}

export interface HelpScoutUpdateCustomerParams
  extends HelpScoutAuthParams,
    HelpScoutCustomerProfileParams {
  customerId: string
  email?: string
  emailType?: string
  phone?: string
  phoneType?: string
}

export interface HelpScoutUpdateCustomerResponse extends ToolResponse {
  output: { customerId: number | null }
}

export type HelpScoutListMailboxesParams = HelpScoutAuthParams & HelpScoutPageParams

export interface HelpScoutListMailboxesResponse extends ToolResponse {
  output: HelpScoutListOutput & { mailboxes: HelpScoutMailbox[] }
}

export interface HelpScoutListFoldersParams extends HelpScoutAuthParams, HelpScoutPageParams {
  mailboxId: string
}

export interface HelpScoutListFoldersResponse extends ToolResponse {
  output: HelpScoutListOutput & { folders: HelpScoutFolder[] }
}

export interface HelpScoutListUsersParams extends HelpScoutAuthParams, HelpScoutPageParams {
  email?: string
  mailboxId?: string
}

export interface HelpScoutListUsersResponse extends ToolResponse {
  output: HelpScoutListOutput & { users: HelpScoutUser[] }
}

export type HelpScoutGetCurrentUserParams = HelpScoutAuthParams

export interface HelpScoutGetCurrentUserResponse extends ToolResponse {
  output: { user: HelpScoutUser; companyId: number | null }
}

export type HelpScoutListTagsParams = HelpScoutAuthParams & HelpScoutPageParams

export interface HelpScoutListTagsResponse extends ToolResponse {
  output: HelpScoutListOutput & { tags: HelpScoutTag[] }
}

export type HelpScoutListTeamsParams = HelpScoutAuthParams & HelpScoutPageParams

export interface HelpScoutListTeamsResponse extends ToolResponse {
  output: HelpScoutListOutput & { teams: HelpScoutTeam[] }
}

export interface HelpScoutListWorkflowsParams extends HelpScoutAuthParams, HelpScoutPageParams {
  mailboxId?: string
  workflowType?: string
}

export interface HelpScoutListWorkflowsResponse extends ToolResponse {
  output: HelpScoutListOutput & { workflows: HelpScoutWorkflow[] }
}

export interface HelpScoutRunWorkflowParams extends HelpScoutAuthParams {
  workflowId: string
  conversationIds: string | string[] | number[]
}

export interface HelpScoutRunWorkflowResponse extends ToolResponse {
  output: { workflowId: number | null; conversationIds: number[] }
}

export interface HelpScoutUpdateCustomFieldsParams extends HelpScoutConversationParams {
  customFields: string | Array<{ id: number | string; value: string | number }>
}

export interface HelpScoutListCustomFieldsParams extends HelpScoutAuthParams, HelpScoutPageParams {
  mailboxId: string
}

export interface HelpScoutListCustomFieldsResponse extends ToolResponse {
  output: HelpScoutListOutput & { customFields: HelpScoutCustomField[] }
}

export interface HelpScoutSnoozeConversationParams extends HelpScoutConversationParams {
  snoozedUntil: string
  unsnoozeOnCustomerReply?: boolean
}

export type HelpScoutUnsnoozeConversationParams = HelpScoutConversationParams

export interface HelpScoutListSavedRepliesParams extends HelpScoutAuthParams {
  mailboxId: string
  includeChatReplies?: boolean
}

export interface HelpScoutListSavedRepliesResponse extends ToolResponse {
  output: { savedReplies: HelpScoutSavedReplySummary[] }
}

export interface HelpScoutGetSavedReplyParams extends HelpScoutAuthParams {
  mailboxId: string
  savedReplyId: string
}

export interface HelpScoutGetSavedReplyResponse extends ToolResponse {
  output: { savedReply: HelpScoutSavedReply }
}

export type HelpScoutListCustomerPropertiesParams = HelpScoutAuthParams

export interface HelpScoutListCustomerPropertiesResponse extends ToolResponse {
  output: { customerProperties: HelpScoutCustomerPropertyDefinition[] }
}

export interface HelpScoutUpdateCustomerPropertiesParams extends HelpScoutAuthParams {
  customerId: string
  properties: string | Record<string, unknown>
}

export interface HelpScoutCreateCustomerThreadParams extends HelpScoutConversationParams {
  customerId?: string
  customerEmail?: string
  text: string
  cc?: string | string[]
  bcc?: string | string[]
}

export interface HelpScoutUpdateConversationCustomerParams extends HelpScoutConversationParams {
  customerId: string
}

export interface HelpScoutListOrganizationsParams extends HelpScoutAuthParams, HelpScoutPageParams {
  organizationSort?: string
}

export interface HelpScoutListOrganizationsResponse extends ToolResponse {
  output: HelpScoutListOutput & { organizations: HelpScoutOrganization[] }
}

export interface HelpScoutGetOrganizationParams extends HelpScoutAuthParams {
  organizationId: string
  includeCounts?: boolean
  includeProperties?: boolean
}

export interface HelpScoutGetOrganizationResponse extends ToolResponse {
  output: { organization: HelpScoutOrganization }
}
