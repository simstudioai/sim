import type { ToolResponse } from '@/tools/types'

/** Send Email */
export interface MailSendParams {
  resendApiKey: string
  fromAddress: string
  to: string
  subject: string
  body: string
  contentType?: 'text' | 'html'
  cc?: string
  bcc?: string
  replyTo?: string
  scheduledAt?: string
  tags?: string
}

export interface MailSendResult extends ToolResponse {
  output: {
    success: boolean
    id: string
    to: string
    subject: string
    body: string
  }
}

/** Get Email */
export interface GetEmailParams {
  resendApiKey: string
  emailId: string
}

export interface GetEmailResult extends ToolResponse {
  output: {
    id: string
    from: string
    to: string[]
    subject: string
    html: string
    text: string | null
    cc: string[]
    bcc: string[]
    replyTo: string[]
    lastEvent: string
    createdAt: string
    scheduledAt: string | null
    tags: Array<{ name: string; value: string }>
  }
}

/** Create Contact */
export interface CreateContactParams {
  resendApiKey: string
  email: string
  firstName?: string
  lastName?: string
  unsubscribed?: boolean
}

export interface CreateContactResult extends ToolResponse {
  output: {
    id: string
  }
}

/** List Contacts */
export interface ListContactsParams {
  resendApiKey: string
}

export interface ListContactsResult extends ToolResponse {
  output: {
    contacts: Array<{
      id: string
      email: string
      first_name: string
      last_name: string
      created_at: string
      unsubscribed: boolean
    }>
    hasMore: boolean
  }
}

/** Get Contact */
export interface GetContactParams {
  resendApiKey: string
  contactId: string
}

export interface GetContactResult extends ToolResponse {
  output: {
    id: string
    email: string
    firstName: string
    lastName: string
    createdAt: string
    unsubscribed: boolean
  }
}

/** Update Contact */
export interface UpdateContactParams {
  resendApiKey: string
  contactId: string
  firstName?: string
  lastName?: string
  unsubscribed?: boolean
}

export interface UpdateContactResult extends ToolResponse {
  output: {
    id: string
  }
}

/** Delete Contact */
export interface DeleteContactParams {
  resendApiKey: string
  contactId: string
}

export interface DeleteContactResult extends ToolResponse {
  output: {
    id: string
    deleted: boolean
  }
}

/** List Domains */
export interface ListDomainsParams {
  resendApiKey: string
}

export interface ListDomainsResult extends ToolResponse {
  output: {
    domains: Array<{
      id: string
      name: string
      status: string
      region: string
      createdAt: string
    }>
    hasMore: boolean
  }
}
