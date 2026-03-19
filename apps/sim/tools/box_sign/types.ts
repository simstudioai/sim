import type { OutputProperty, ToolResponse } from '@/tools/types'

export interface BoxSignCreateRequestParams {
  accessToken: string
  sourceFileIds: string
  signerEmail: string
  signerRole?: string
  additionalSigners?: string
  parentFolderId?: string
  emailSubject?: string
  emailMessage?: string
  name?: string
  daysValid?: number
  areRemindersEnabled?: boolean
  areTextSignaturesEnabled?: boolean
  signatureColor?: string
  redirectUrl?: string
  declinedRedirectUrl?: string
  isDocumentPreparationNeeded?: boolean
  externalId?: string
}

export interface BoxSignGetRequestParams {
  accessToken: string
  signRequestId: string
}

export interface BoxSignListRequestsParams {
  accessToken: string
  limit?: number
  marker?: string
}

export interface BoxSignCancelRequestParams {
  accessToken: string
  signRequestId: string
}

export interface BoxSignResendRequestParams {
  accessToken: string
  signRequestId: string
}

export interface BoxSignResponse extends ToolResponse {
  output: {
    id: string
    status: string
    name: string | null
    shortId: string | null
    signers: Array<Record<string, unknown>>
    sourceFiles: Array<Record<string, unknown>>
    emailSubject: string | null
    emailMessage: string | null
    daysValid: number | null
    createdAt: string | null
    autoExpireAt: string | null
    prepareUrl: string | null
    senderEmail: string | null
  }
}

export interface BoxSignListResponse extends ToolResponse {
  output: {
    signRequests: Array<Record<string, unknown>>
    count: number
    nextMarker: string | null
  }
}

const SIGNER_OUTPUT_PROPERTIES = {
  email: { type: 'string', description: 'Signer email address' },
  role: { type: 'string', description: 'Signer role (signer, approver, final_copy_reader)' },
  hasViewedDocument: {
    type: 'boolean',
    description: 'Whether the signer has viewed the document',
    optional: true,
  },
  signerDecision: {
    type: 'json',
    description: 'Signer decision details (type, finalized_at, additional_info)',
    optional: true,
  },
  embedUrl: {
    type: 'string',
    description: 'URL for embedded signing experience',
    optional: true,
  },
  order: { type: 'number', description: 'Order in signing sequence', optional: true },
} as const satisfies Record<string, OutputProperty>

const SOURCE_FILE_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'File ID' },
  type: { type: 'string', description: 'File type' },
  name: { type: 'string', description: 'File name', optional: true },
} as const satisfies Record<string, OutputProperty>

export const SIGN_REQUEST_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Sign request ID' },
  status: {
    type: 'string',
    description:
      'Request status (converting, created, sent, viewed, signed, cancelled, declined, expired, error_converting, error_sending, finalizing, error_finalizing)',
  },
  name: { type: 'string', description: 'Sign request name', optional: true },
  shortId: { type: 'string', description: 'Human-readable short ID', optional: true },
  signers: {
    type: 'array',
    description: 'List of signers',
    items: {
      type: 'object',
      properties: SIGNER_OUTPUT_PROPERTIES,
    },
  },
  sourceFiles: {
    type: 'array',
    description: 'Source files for signing',
    items: {
      type: 'object',
      properties: SOURCE_FILE_OUTPUT_PROPERTIES,
    },
  },
  emailSubject: {
    type: 'string',
    description: 'Custom email subject line',
    optional: true,
  },
  emailMessage: {
    type: 'string',
    description: 'Custom email message body',
    optional: true,
  },
  daysValid: {
    type: 'number',
    description: 'Number of days the request is valid',
    optional: true,
  },
  createdAt: { type: 'string', description: 'Creation timestamp', optional: true },
  autoExpireAt: { type: 'string', description: 'Auto-expiration timestamp', optional: true },
  prepareUrl: {
    type: 'string',
    description: 'URL for document preparation (if preparation is needed)',
    optional: true,
  },
  senderEmail: { type: 'string', description: 'Email of the sender', optional: true },
} as const satisfies Record<string, OutputProperty>

export const SIGN_REQUEST_LIST_OUTPUT_PROPERTIES = {
  signRequests: {
    type: 'array',
    description: 'List of sign requests',
    items: {
      type: 'object',
      properties: SIGN_REQUEST_OUTPUT_PROPERTIES,
    },
  },
  count: { type: 'number', description: 'Number of sign requests returned in this page' },
  nextMarker: {
    type: 'string',
    description: 'Marker for next page of results',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>
