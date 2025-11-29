import type { ToolResponse } from '@/tools/types'

// Send Message
export interface SendMessageParams {
  apiKey: string
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
export interface GetMessageParams {
  apiKey: string
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
    messageHeaders: any
    contentIdMap: any
  }
}

// List Messages (Events)
export interface ListMessagesParams {
  apiKey: string
  domain: string
  event?: string
  limit?: number
}

export interface ListMessagesResult extends ToolResponse {
  output: {
    success: boolean
    items: any[]
    paging: any
  }
}

// Create Mailing List
export interface CreateMailingListParams {
  apiKey: string
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
export interface GetMailingListParams {
  apiKey: string
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
export interface AddListMemberParams {
  apiKey: string
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
      vars: any
    }
  }
}

// List Domains
export interface ListDomainsParams {
  apiKey: string
}

export interface ListDomainsResult extends ToolResponse {
  output: {
    success: boolean
    totalCount: number
    items: any[]
  }
}

// Get Domain
export interface GetDomainParams {
  apiKey: string
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
