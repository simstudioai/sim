import type { UserFile } from '@/executor/types'
import type { ToolResponse, WorkflowToolExecutionContext } from '@/tools/types'

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
}

export interface WindchillStateTransition {
  value: string | null
  display: string | null
}

export interface WindchillDocumentUsageLink {
  id: string | null
  parent: WindchillDocument | null
  child: WindchillDocument | null
}

export interface WindchillPageInfo {
  count: number
  totalCount: number | null
  nextLink: string | null
}

export interface WindchillCreateDocumentInput {
  name: string
  containerOid: string
  number?: string
  title?: string
  description?: string
  folderOid?: string
  attributes?: Record<string, string | number | boolean | null>
}

export interface WindchillUpdateDocumentInput {
  id: string
  attributes: Record<string, string | number | boolean | null>
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
  attributes?: Record<string, string | number | boolean | null>
  documents?: WindchillCreateDocumentInput[] | WindchillUpdateDocumentInput[]
  checkOutNote?: string
  checkInNote?: string
  keepCheckedOut?: boolean
  versionId?: string
  stateValue?: string
  stateDisplay?: string
  securityLabelUpdates?: WindchillSecurityLabelInput[]
  primaryFile?: unknown
  attachmentFiles?: unknown
  fileName?: string
  select?: string
  filter?: string
  expand?: string
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
  document?: WindchillDocument | null
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
