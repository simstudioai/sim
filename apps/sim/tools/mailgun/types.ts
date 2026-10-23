import type { ToolResponse } from '@/tools/types'

interface MailgunMessageHeaders {
  [key: string]: string | string[]
}

interface MailgunMessageItem {
  timestamp: number
  event: string
  recipient: string
  sender?: string
  subject?: string
  deliveryStatus?: string
  [key: string]: unknown
}

interface MailgunDomainItem {
  name: string
  state: string
  type: string
  created_at?: string
  smtp_login?: string
  [key: string]: unknown
}

interface MailgunPaging {
  first?: string
  next?: string
  previous?: string
  last?: string
}

/** Region that hosts the Mailgun account; omitted means US. */
export type MailgunRegion = 'us' | 'eu'

interface MailgunBaseParams {
  apiKey: string
  region?: MailgunRegion
}

// Send Message
export interface SendMessageParams extends MailgunBaseParams {
  domain: string
  from: string
  to: string
  subject: string
  text?: string
  html?: string
  cc?: string
  bcc?: string
  tags?: string
}

export interface SendMessageResult extends ToolResponse {
  output: {
    success: boolean
    id: string
    message: string
  }
}

// Get Message
export interface GetMessageParams extends MailgunBaseParams {
  domain: string
  messageKey: string
}

export interface GetMessageResult extends ToolResponse {
  output: {
    success: boolean
    recipients: string
    from: string
    subject: string
    bodyPlain: string
    strippedText: string
    strippedSignature: string
    bodyHtml: string
    strippedHtml: string
    attachmentCount: number
    timestamp: number
    messageHeaders: MailgunMessageHeaders
    contentIdMap: Record<string, string>
  }
}

// List Messages (Events)
export interface ListMessagesParams extends MailgunBaseParams {
  domain: string
  event?: string
  limit?: number
}

export interface ListMessagesResult extends ToolResponse {
  output: {
    success: boolean
    items: MailgunMessageItem[]
    paging: MailgunPaging
  }
}

// Create Mailing List
export interface CreateMailingListParams extends MailgunBaseParams {
  address: string
  name?: string
  description?: string
  accessLevel?: 'readonly' | 'members' | 'everyone'
}

export interface CreateMailingListResult extends ToolResponse {
  output: {
    success: boolean
    message: string
    list: {
      address: string
      name: string
      description: string
      accessLevel: string
      createdAt: string
    }
  }
}

// Get Mailing List
export interface GetMailingListParams extends MailgunBaseParams {
  address: string
}

export interface GetMailingListResult extends ToolResponse {
  output: {
    success: boolean
    list: {
      address: string
      name: string
      description: string
      accessLevel: string
      membersCount: number
      createdAt: string
    }
  }
}

// Add List Member
export interface AddListMemberParams extends MailgunBaseParams {
  listAddress: string
  address: string
  name?: string
  vars?: string
  subscribed?: boolean
}

export interface AddListMemberResult extends ToolResponse {
  output: {
    success: boolean
    message: string
    member: {
      address: string
      name: string
      subscribed: boolean
      vars: Record<string, string | number | boolean | null>
    }
  }
}

// List Domains
export type ListDomainsParams = MailgunBaseParams

export interface ListDomainsResult extends ToolResponse {
  output: {
    success: boolean
    totalCount: number
    items: MailgunDomainItem[]
  }
}

// Get Domain
export interface GetDomainParams extends MailgunBaseParams {
  domain: string
}

export interface GetDomainResult extends ToolResponse {
  output: {
    success: boolean
    domain: {
      name: string
      smtpLogin: string
      smtpPassword: string
      spamAction: string
      state: string
      createdAt: string
      type: string
    }
  }
}
