import type { RawFileInput } from '@/lib/uploads/utils/file-schemas'
import type { UserFile } from '@/executor/types'
import type { ToolOutputProperty, ToolResponse, WorkflowToolExecutionContext } from '@/tools/types'

export const WINDCHILL_DOCUMENT_PROPERTIES = {
  id: { type: 'string', description: 'Windchill object identifier', nullable: true },
  name: { type: 'string', description: 'Document name', nullable: true },
  number: { type: 'string', description: 'Document number', nullable: true },
  title: { type: 'string', description: 'Document title', nullable: true },
  description: { type: 'string', description: 'Document description', nullable: true },
  state: { type: 'string', description: 'Internal life cycle state value', nullable: true },
  stateDisplay: { type: 'string', description: 'Displayed life cycle state value', nullable: true },
  versionId: { type: 'string', description: 'Version identifier', nullable: true },
  revision: { type: 'string', description: 'Revision identifier', nullable: true },
  version: { type: 'string', description: 'Version and iteration', nullable: true },
  latest: { type: 'boolean', description: 'Whether this is the latest version', nullable: true },
  checkoutState: { type: 'string', description: 'Checkout state', nullable: true },
  folderName: { type: 'string', description: 'Folder name', nullable: true },
  folderLocation: { type: 'string', description: 'Folder path', nullable: true },
} as const satisfies Record<string, ToolOutputProperty>

export const WINDCHILL_CONTENT_PROPERTIES = {
  id: { type: 'string', description: 'Content object identifier', nullable: true },
  fileName: { type: 'string', description: 'Content file name', nullable: true },
  description: { type: 'string', description: 'Content description', nullable: true },
  format: { type: 'string', description: 'Windchill content format', nullable: true },
  mimeType: { type: 'string', description: 'Content MIME type', nullable: true },
  fileSize: { type: 'number', description: 'Content size in bytes', nullable: true },
  contentType: {
    type: 'string',
    description: 'Windchill OData content entity type',
    nullable: true,
  },
  displayName: { type: 'string', description: 'Displayed content name', nullable: true },
  urlLocation: { type: 'string', description: 'URL-data location', nullable: true },
  externalLocation: { type: 'string', description: 'External-storage location', nullable: true },
} as const satisfies Record<string, ToolOutputProperty>

export const WINDCHILL_DOCUMENT_OUTPUTS = {
  operation: { type: 'string', description: 'Windchill operation that was executed' },
  document: {
    type: 'object',
    description: 'Windchill document',
    properties: WINDCHILL_DOCUMENT_PROPERTIES,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const WINDCHILL_LIST_DOCUMENTS_OUTPUTS = {
  operation: { type: 'string', description: 'Windchill operation that was executed' },
  documents: {
    type: 'array',
    description: 'Windchill documents',
    items: { type: 'object', properties: WINDCHILL_DOCUMENT_PROPERTIES },
  },
  pageInfo: {
    type: 'object',
    description: 'OData pagination information',
    properties: {
      count: { type: 'number', description: 'Number of items returned in this page' },
      totalCount: { type: 'number', description: 'Total matching items', nullable: true },
      nextLink: {
        type: 'string',
        description: 'URL returned by Windchill for the next page',
        nullable: true,
      },
    },
  },
} as const satisfies Record<string, ToolOutputProperty>

export const WINDCHILL_USAGE_LINK_PROPERTIES = {
  id: { type: 'string', description: 'Document usage link OID', nullable: true },
  parent: {
    type: 'object',
    description: 'Parent document',
    nullable: true,
    properties: WINDCHILL_DOCUMENT_PROPERTIES,
  },
  child: {
    type: 'object',
    description: 'Child document',
    nullable: true,
    properties: WINDCHILL_DOCUMENT_PROPERTIES,
  },
  children: {
    type: 'array',
    description: 'Nested child usage links with the same recursive shape',
    items: { type: 'json' },
  },
} as const satisfies Record<string, ToolOutputProperty>

export const WINDCHILL_USAGE_LINK_OUTPUT = {
  type: 'object',
  description: 'Document usage link',
  properties: WINDCHILL_USAGE_LINK_PROPERTIES,
} as const satisfies ToolOutputProperty

export const WINDCHILL_STRUCTURE_OUTPUTS = {
  operation: { type: 'string', description: 'Windchill operation that was executed' },
  structure: {
    type: 'array',
    description: 'Document usage links, including recursively expanded child links',
    items: WINDCHILL_USAGE_LINK_OUTPUT,
  },
  pageInfo: {
    type: 'object',
    description: 'OData pagination information',
    properties: {
      count: { type: 'number', description: 'Number of items returned in this page' },
      totalCount: { type: 'number', description: 'Total matching items', nullable: true },
      nextLink: {
        type: 'string',
        description: 'URL returned by Windchill for the next page',
        nullable: true,
      },
    },
  },
} as const satisfies Record<string, ToolOutputProperty>

export const WINDCHILL_STATE_OUTPUTS = {
  operation: { type: 'string', description: 'Windchill operation that was executed' },
  states: {
    type: 'array',
    description: 'Valid lifecycle transitions',
    items: {
      type: 'object',
      properties: {
        value: { type: 'string', description: 'Internal state value', nullable: true },
        display: { type: 'string', description: 'Displayed state value', nullable: true },
      },
    },
  },
} as const satisfies Record<string, ToolOutputProperty>

export const WINDCHILL_PRIMARY_CONTENT_OUTPUTS = {
  operation: { type: 'string', description: 'Windchill operation that was executed' },
  content: {
    type: 'object',
    description: 'Primary-content metadata',
    nullable: true,
    properties: WINDCHILL_CONTENT_PROPERTIES,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const WINDCHILL_ATTACHMENTS_OUTPUTS = {
  operation: { type: 'string', description: 'Windchill operation that was executed' },
  attachments: {
    type: 'array',
    description: 'Document attachments',
    items: { type: 'object', properties: WINDCHILL_CONTENT_PROPERTIES },
  },
  pageInfo: {
    type: 'object',
    description: 'OData pagination information',
    properties: {
      count: { type: 'number', description: 'Number of items returned in this page' },
      totalCount: { type: 'number', description: 'Total matching items', nullable: true },
      nextLink: {
        type: 'string',
        description: 'URL returned by Windchill for the next page',
        nullable: true,
      },
    },
  },
} as const satisfies Record<string, ToolOutputProperty>

export const WINDCHILL_AFFECTED_OUTPUTS = {
  operation: { type: 'string', description: 'Windchill operation that was executed' },
  affectedIds: {
    type: 'array',
    description: 'Document identifiers affected by the operation',
    items: { type: 'string' },
  },
} as const satisfies Record<string, ToolOutputProperty>

export const WINDCHILL_SINGLE_MUTATION_OUTPUTS = {
  ...WINDCHILL_AFFECTED_OUTPUTS,
  document: {
    type: 'object',
    description: 'Document returned by Windchill when the operation returns one',
    optional: true,
    properties: WINDCHILL_DOCUMENT_PROPERTIES,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const WINDCHILL_BULK_MUTATION_OUTPUTS = {
  ...WINDCHILL_AFFECTED_OUTPUTS,
  documents: {
    type: 'array',
    description: 'Documents returned by Windchill when the operation returns them',
    optional: true,
    items: { type: 'object', properties: WINDCHILL_DOCUMENT_PROPERTIES },
  },
} as const satisfies Record<string, ToolOutputProperty>

export const WINDCHILL_FILE_OUTPUTS = {
  operation: { type: 'string', description: 'Windchill operation that was executed' },
  file: { type: 'file', description: 'Downloaded content stored as a canonical UserFile' },
  fileName: { type: 'string', description: 'Downloaded file name' },
  mimeType: { type: 'string', description: 'Downloaded content MIME type' },
} as const satisfies Record<string, ToolOutputProperty>

export const WINDCHILL_UPLOAD_OUTPUTS = {
  operation: { type: 'string', description: 'Windchill operation that was executed' },
  affectedIds: {
    type: 'array',
    description: 'Document identifiers affected by the upload',
    items: { type: 'string' },
  },
  uploadedFileNames: {
    type: 'array',
    description: 'Names of files accepted by Windchill',
    items: { type: 'string' },
  },
} as const satisfies Record<string, ToolOutputProperty>

export const WINDCHILL_OPERATIONS = [
  'windchill_list_documents',
  'windchill_get_document',
  'windchill_get_document_structure',
  'windchill_get_valid_state_transitions',
  'windchill_get_primary_content',
  'windchill_list_attachments',
  'windchill_create_document',
  'windchill_create_documents',
  'windchill_update_document',
  'windchill_update_common_properties',
  'windchill_update_documents',
  'windchill_delete_document',
  'windchill_delete_documents',
  'windchill_check_out_document',
  'windchill_check_out_documents',
  'windchill_check_in_document',
  'windchill_check_in_documents',
  'windchill_undo_check_out_document',
  'windchill_undo_check_out_documents',
  'windchill_revise_document',
  'windchill_revise_documents',
  'windchill_set_lifecycle_state',
  'windchill_update_document_security_labels',
  'windchill_download_primary_content',
  'windchill_upload_primary_content',
  'windchill_download_attachment',
  'windchill_upload_attachments',
] as const

export type WindchillOperation = (typeof WINDCHILL_OPERATIONS)[number]

export interface WindchillDocument {
  id: string | null
  name: string | null
  number: string | null
  title: string | null
  description: string | null
  state: string | null
  stateDisplay: string | null
  versionId: string | null
  revision: string | null
  version: string | null
  latest: boolean | null
  checkoutState: string | null
  folderName: string | null
  folderLocation: string | null
}

export interface WindchillContent {
  id: string | null
  fileName: string | null
  description: string | null
  format: string | null
  mimeType: string | null
  fileSize: number | null
  contentType: string | null
  displayName: string | null
  urlLocation: string | null
  externalLocation: string | null
}

export interface WindchillStateTransition {
  value: string | null
  display: string | null
}

export interface WindchillDocumentUsageLink {
  id: string | null
  parent: WindchillDocument | null
  child: WindchillDocument | null
  children: WindchillDocumentUsageLink[]
}

export interface WindchillPageInfo {
  count: number
  totalCount: number | null
  nextLink: string | null
}

export type WindchillAttributeValue =
  | string
  | number
  | boolean
  | null
  | WindchillAttributeValue[]
  | { [key: string]: WindchillAttributeValue }

export interface WindchillCreateDocumentInput {
  name: string
  containerOid: string
  number?: string
  title?: string
  description?: string
  folderOid?: string
  attributes?: Record<string, WindchillAttributeValue>
}

export interface WindchillUpdateDocumentInput {
  id: string
  attributes: Record<string, WindchillAttributeValue>
}

export interface WindchillSecurityLabelInput {
  id: string
  labels: Record<string, string>
}

export interface WindchillParams {
  baseUrl: string
  username: string
  password: string
  documentOid?: string
  documentOids?: string[]
  attachmentOid?: string
  name?: string
  number?: string
  title?: string
  description?: string
  containerOid?: string
  folderOid?: string
  attributes?: Record<string, WindchillAttributeValue>
  commonProperties?: Record<string, WindchillAttributeValue>
  documents?: WindchillCreateDocumentInput[] | WindchillUpdateDocumentInput[]
  checkOutNote?: string
  checkInNote?: string
  keepCheckedOut?: boolean
  versionId?: string
  stateValue?: string
  stateDisplay?: string
  securityLabelUpdates?: WindchillSecurityLabelInput[]
  primaryFile?: RawFileInput
  attachmentFiles?: RawFileInput[]
  fileName?: string
  select?: string
  filter?: string
  orderBy?: string
  top?: number
  skip?: number
  count?: boolean
  latestVersion?: boolean
  nextLink?: string
  structureDepth?: number
  _context?: WorkflowToolExecutionContext
}

export interface WindchillOutput {
  operation: WindchillOperation
  document?: WindchillDocument
  documents?: WindchillDocument[]
  structure?: WindchillDocumentUsageLink[]
  states?: WindchillStateTransition[]
  content?: WindchillContent | null
  attachments?: WindchillContent[]
  pageInfo?: WindchillPageInfo
  affectedIds?: string[]
  uploadedFileNames?: string[]
  file?: UserFile
  fileName?: string
  mimeType?: string
}

export interface WindchillResponse extends ToolResponse {
  output: WindchillOutput
}
