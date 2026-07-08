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

/** Cancel Email */
export interface CancelEmailParams {
  resendApiKey: string
  cancelEmailId: string
}

export interface CancelEmailResult extends ToolResponse {
  output: {
    id: string
  }
}

/** Create Audience */
export interface CreateAudienceParams {
  resendApiKey: string
  audienceName: string
}

export interface CreateAudienceResult extends ToolResponse {
  output: {
    id: string
    name: string
  }
}

/** Get Audience */
export interface GetAudienceParams {
  resendApiKey: string
  audienceId: string
}

export interface GetAudienceResult extends ToolResponse {
  output: {
    id: string
    name: string
    createdAt: string
  }
}

/** List Audiences */
export interface ListAudiencesParams {
  resendApiKey: string
}

export interface ListAudiencesResult extends ToolResponse {
  output: {
    audiences: Array<{
      id: string
      name: string
      created_at: string
    }>
    hasMore: boolean
  }
}

/** Delete Audience */
export interface DeleteAudienceParams {
  resendApiKey: string
  audienceId: string
}

export interface DeleteAudienceResult extends ToolResponse {
  output: {
    id: string
    deleted: boolean
  }
}

/** Create Broadcast */
export interface CreateBroadcastParams {
  resendApiKey: string
  audienceId: string
  broadcastFrom: string
  broadcastSubject: string
  broadcastReplyTo?: string
  broadcastHtml?: string
  broadcastText?: string
  broadcastName?: string
  broadcastPreviewText?: string
}

export interface CreateBroadcastResult extends ToolResponse {
  output: {
    id: string
  }
}

/** Send Broadcast */
export interface SendBroadcastParams {
  resendApiKey: string
  broadcastId: string
  broadcastScheduledAt?: string
}

export interface SendBroadcastResult extends ToolResponse {
  output: {
    id: string
  }
}

/** Get Broadcast */
export interface GetBroadcastParams {
  resendApiKey: string
  broadcastId: string
}

export interface GetBroadcastResult extends ToolResponse {
  output: {
    id: string
    name: string
    audienceId: string | null
    segmentId: string | null
    from: string
    subject: string
    replyTo: string | string[] | null
    previewText: string | null
    status: string
    createdAt: string
    scheduledAt: string | null
    sentAt: string | null
  }
}
