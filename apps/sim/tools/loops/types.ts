import type { ToolResponse } from '@/tools/types'

export interface LoopsBaseParams {
  apiKey: string
}

export interface LoopsCreateContactParams extends LoopsBaseParams {
  email: string
  firstName?: string
  lastName?: string
  source?: string
  subscribed?: boolean
  userGroup?: string
  userId?: string
  mailingLists?: string | Record<string, boolean>
  customProperties?: string | Record<string, unknown>
}

export interface LoopsUpdateContactParams extends LoopsBaseParams {
  email?: string
  userId?: string
  firstName?: string
  lastName?: string
  source?: string
  subscribed?: boolean
  userGroup?: string
  mailingLists?: string | Record<string, boolean>
  customProperties?: string | Record<string, unknown>
}

export interface LoopsFindContactParams extends LoopsBaseParams {
  email?: string
  userId?: string
}

export interface LoopsDeleteContactParams extends LoopsBaseParams {
  email?: string
  userId?: string
}

export interface LoopsSendTransactionalEmailParams extends LoopsBaseParams {
  email: string
  transactionalId: string
  dataVariables?: string | Record<string, string | number>
  addToAudience?: boolean
  attachments?: string | { filename: string; contentType: string; data: string }[]
}

export interface LoopsSendEventParams extends LoopsBaseParams {
  email?: string
  userId?: string
  eventName: string
  eventProperties?: string | Record<string, string | number | boolean>
  mailingLists?: string | Record<string, boolean>
}

export interface LoopsListMailingListsParams extends LoopsBaseParams {}

export interface LoopsListTransactionalEmailsParams extends LoopsBaseParams {
  perPage?: string
  cursor?: string
}

export interface LoopsCreateContactPropertyParams extends LoopsBaseParams {
  name: string
  type: string
}

export interface LoopsListContactPropertiesParams extends LoopsBaseParams {
  list?: string
}

export interface LoopsContact {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  source: string | null
  subscribed: boolean
  userGroup: string | null
  userId: string | null
  mailingLists: Record<string, boolean>
  optInStatus: string | null
}

export interface LoopsCreateContactResponse extends ToolResponse {
  output: {
    success: boolean
    id: string | null
  }
}

export interface LoopsUpdateContactResponse extends ToolResponse {
  output: {
    success: boolean
    id: string | null
  }
}

export interface LoopsFindContactResponse extends ToolResponse {
  output: {
    contacts: LoopsContact[]
  }
}

export interface LoopsDeleteContactResponse extends ToolResponse {
  output: {
    success: boolean
    message: string | null
  }
}

export interface LoopsSendTransactionalEmailResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

export interface LoopsSendEventResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

export interface LoopsListMailingListsResponse extends ToolResponse {
  output: {
    mailingLists: {
      id: string
      name: string
      description: string | null
      isPublic: boolean
    }[]
  }
}

export interface LoopsListTransactionalEmailsResponse extends ToolResponse {
  output: {
    transactionalEmails: {
      id: string
      name: string
      lastUpdated: string
      dataVariables: string[]
    }[]
    pagination: {
      totalResults: number
      returnedResults: number
      perPage: number
      totalPages: number
      nextCursor: string | null
      nextPage: string | null
    }
  }
}

export interface LoopsCreateContactPropertyResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

export interface LoopsListContactPropertiesResponse extends ToolResponse {
  output: {
    properties: {
      key: string
      label: string
      type: string
    }[]
  }
}

export type LoopsResponse =
  | LoopsCreateContactResponse
  | LoopsUpdateContactResponse
  | LoopsFindContactResponse
  | LoopsDeleteContactResponse
  | LoopsSendTransactionalEmailResponse
  | LoopsSendEventResponse
  | LoopsListMailingListsResponse
  | LoopsListTransactionalEmailsResponse
  | LoopsCreateContactPropertyResponse
  | LoopsListContactPropertiesResponse

export const LOOPS_CONTACT_OUTPUT_PROPERTIES = {
  id: { type: 'string' as const, description: 'Loops-assigned contact ID' },
  email: { type: 'string' as const, description: 'Contact email address' },
  firstName: { type: 'string' as const, description: 'Contact first name', optional: true },
  lastName: { type: 'string' as const, description: 'Contact last name', optional: true },
  source: {
    type: 'string' as const,
    description: 'Source the contact was created from',
    optional: true,
  },
  subscribed: {
    type: 'boolean' as const,
    description: 'Whether the contact receives campaign emails',
  },
  userGroup: { type: 'string' as const, description: 'Contact user group', optional: true },
  userId: { type: 'string' as const, description: 'External user identifier', optional: true },
  mailingLists: {
    type: 'object' as const,
    description: 'Mailing list IDs mapped to subscription status',
    optional: true,
  },
  optInStatus: {
    type: 'string' as const,
    description: 'Double opt-in status: pending, accepted, rejected, or null',
    optional: true,
  },
}
