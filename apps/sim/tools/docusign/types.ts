import type { OutputProperty, ToolResponse } from '@/tools/types'

/** Common envelope output properties */
export const ENVELOPE_OUTPUT_PROPERTIES = {
  envelopeId: { type: 'string', description: 'Unique envelope identifier' },
  status: {
    type: 'string',
    description: 'Envelope status (created, sent, delivered, completed, declined, voided)',
  },
  emailSubject: { type: 'string', description: 'Email subject line' },
  sentDateTime: {
    type: 'string',
    description: 'ISO 8601 datetime when envelope was sent',
    optional: true,
  },
  completedDateTime: {
    type: 'string',
    description: 'ISO 8601 datetime when envelope was completed',
    optional: true,
  },
  createdDateTime: { type: 'string', description: 'ISO 8601 datetime when envelope was created' },
  statusChangedDateTime: { type: 'string', description: 'ISO 8601 datetime of last status change' },
} as const satisfies Record<string, OutputProperty>

export const RECIPIENT_OUTPUT_PROPERTIES = {
  recipientId: { type: 'string', description: 'Recipient identifier' },
  name: { type: 'string', description: 'Recipient name' },
  email: { type: 'string', description: 'Recipient email address' },
  status: {
    type: 'string',
    description: 'Recipient signing status (sent, delivered, completed, declined)',
  },
  signedDateTime: {
    type: 'string',
    description: 'ISO 8601 datetime when recipient signed',
    optional: true,
  },
  deliveredDateTime: {
    type: 'string',
    description: 'ISO 8601 datetime when delivered to recipient',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const TEMPLATE_OUTPUT_PROPERTIES = {
  templateId: { type: 'string', description: 'Template identifier' },
  name: { type: 'string', description: 'Template name' },
  description: { type: 'string', description: 'Template description', optional: true },
  shared: { type: 'boolean', description: 'Whether template is shared', optional: true },
  created: { type: 'string', description: 'ISO 8601 creation date' },
  lastModified: { type: 'string', description: 'ISO 8601 last modified date' },
} as const satisfies Record<string, OutputProperty>

export const ENVELOPE_OBJECT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'DocuSign envelope',
  properties: ENVELOPE_OUTPUT_PROPERTIES,
}

export const ENVELOPES_ARRAY_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of DocuSign envelopes',
  items: {
    type: 'object',
    properties: ENVELOPE_OUTPUT_PROPERTIES,
  },
}

export const RECIPIENT_OBJECT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'DocuSign recipient',
  properties: RECIPIENT_OUTPUT_PROPERTIES,
}

export const RECIPIENTS_ARRAY_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of DocuSign recipients',
  items: {
    type: 'object',
    properties: RECIPIENT_OUTPUT_PROPERTIES,
  },
}

export const TEMPLATES_ARRAY_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of DocuSign templates',
  items: {
    type: 'object',
    properties: TEMPLATE_OUTPUT_PROPERTIES,
  },
}

/** Params interfaces */
export interface DocuSignSendEnvelopeParams {
  accessToken: string
  emailSubject: string
  emailBody?: string
  signerEmail: string
  signerName: string
  ccEmail?: string
  ccName?: string
  file?: unknown
  status?: string
}

export interface DocuSignCreateFromTemplateParams {
  accessToken: string
  templateId: string
  emailSubject?: string
  emailBody?: string
  templateRoles: string
  status?: string
}

export interface DocuSignGetEnvelopeParams {
  accessToken: string
  envelopeId: string
}

export interface DocuSignListEnvelopesParams {
  accessToken: string
  fromDate?: string
  toDate?: string
  envelopeStatus?: string
  searchText?: string
  count?: string
}

export interface DocuSignVoidEnvelopeParams {
  accessToken: string
  envelopeId: string
  voidedReason: string
}

export interface DocuSignDownloadDocumentParams {
  accessToken: string
  envelopeId: string
  documentId?: string
}

export interface DocuSignListTemplatesParams {
  accessToken: string
  searchText?: string
  count?: string
}

export interface DocuSignListRecipientsParams {
  accessToken: string
  envelopeId: string
}

/** Response interfaces */
export interface DocuSignSendEnvelopeResponse extends ToolResponse {
  output: {
    envelopeId: string
    status: string
    statusDateTime: string | null
    uri: string | null
  }
}

export interface DocuSignCreateFromTemplateResponse extends ToolResponse {
  output: {
    envelopeId: string
    status: string
    statusDateTime: string | null
    uri: string | null
  }
}

export interface DocuSignGetEnvelopeResponse extends ToolResponse {
  output: {
    envelopeId: string
    status: string
    emailSubject: string | null
    sentDateTime: string | null
    completedDateTime: string | null
    createdDateTime: string | null
    statusChangedDateTime: string | null
    voidedReason: string | null
    signerCount: number
    documentCount: number
  }
}

export interface DocuSignListEnvelopesResponse extends ToolResponse {
  output: {
    envelopes: Array<{
      envelopeId: string
      status: string
      emailSubject: string | null
      sentDateTime: string | null
      completedDateTime: string | null
      createdDateTime: string | null
      statusChangedDateTime: string | null
    }>
    totalSetSize: number
    resultSetSize: number
  }
}

export interface DocuSignVoidEnvelopeResponse extends ToolResponse {
  output: {
    envelopeId: string
    status: string
  }
}

export interface DocuSignDownloadDocumentResponse extends ToolResponse {
  output: {
    base64Content: string
    mimeType: string
    fileName: string
  }
}

export interface DocuSignListTemplatesResponse extends ToolResponse {
  output: {
    templates: Array<{
      templateId: string
      name: string
      description: string | null
      shared: boolean
      created: string | null
      lastModified: string | null
    }>
    totalSetSize: number
    resultSetSize: number
  }
}

export interface DocuSignListRecipientsResponse extends ToolResponse {
  output: {
    signers: Array<{
      recipientId: string
      name: string
      email: string
      status: string
      signedDateTime: string | null
      deliveredDateTime: string | null
    }>
    carbonCopies: Array<{
      recipientId: string
      name: string
      email: string
      status: string
    }>
  }
}

export type DocuSignResponse =
  | DocuSignSendEnvelopeResponse
  | DocuSignCreateFromTemplateResponse
  | DocuSignGetEnvelopeResponse
  | DocuSignListEnvelopesResponse
  | DocuSignVoidEnvelopeResponse
  | DocuSignDownloadDocumentResponse
  | DocuSignListTemplatesResponse
  | DocuSignListRecipientsResponse
