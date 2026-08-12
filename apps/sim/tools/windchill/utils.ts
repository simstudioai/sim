import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import {
  type WindchillOperationResponse,
  windchillOperationResponseSchema,
} from '@/lib/api/contracts/tools/windchill'
import type { ToolConfig, ToolOutputProperty } from '@/tools/types'
import type {
  WindchillContent,
  WindchillDocument,
  WindchillDocumentUsageLink,
  WindchillOperation,
  WindchillOutput,
  WindchillParams,
  WindchillResponse,
  WindchillStateTransition,
} from '@/tools/windchill/types'

type ToolParamDefinition = ToolConfig<WindchillParams, WindchillResponse>['params'][string]

interface WindchillOperationDefinition {
  name: string
  description: string
  params: readonly (keyof WindchillParams)[]
  outputs: Record<string, ToolOutputProperty>
  directRead?: true
}

const DOCUMENT_PROPERTIES = {
  id: { type: 'string', description: 'Windchill object identifier', nullable: true },
  name: { type: 'string', description: 'Document name', nullable: true },
  number: { type: 'string', description: 'Document number', nullable: true },
  title: { type: 'string', description: 'Document title', nullable: true },
  description: { type: 'string', description: 'Document description', nullable: true },
  state: { type: 'string', description: 'Life cycle state', nullable: true },
  versionId: { type: 'string', description: 'Version identifier', nullable: true },
  revision: { type: 'string', description: 'Revision identifier', nullable: true },
  version: { type: 'string', description: 'Version and iteration', nullable: true },
  latest: { type: 'boolean', description: 'Whether this is the latest version', nullable: true },
  checkoutState: { type: 'string', description: 'Checkout state', nullable: true },
  folderName: { type: 'string', description: 'Folder name', nullable: true },
  folderLocation: { type: 'string', description: 'Folder path', nullable: true },
} as const satisfies Record<string, ToolOutputProperty>

const CONTENT_PROPERTIES = {
  id: { type: 'string', description: 'Content object identifier', nullable: true },
  fileName: { type: 'string', description: 'Content file name', nullable: true },
  description: { type: 'string', description: 'Content description', nullable: true },
  format: { type: 'string', description: 'Windchill content format', nullable: true },
  mimeType: { type: 'string', description: 'Content MIME type', nullable: true },
  fileSize: { type: 'number', description: 'Content size in bytes', nullable: true },
} as const satisfies Record<string, ToolOutputProperty>

const OPERATION_OUTPUT = {
  operation: { type: 'string', description: 'Windchill operation that was executed' },
} as const satisfies Record<string, ToolOutputProperty>

const DOCUMENT_OUTPUT = {
  ...OPERATION_OUTPUT,
  document: {
    type: 'object',
    description: 'Windchill document',
    nullable: true,
    properties: DOCUMENT_PROPERTIES,
  },
} satisfies Record<string, ToolOutputProperty>

const DOCUMENTS_OUTPUT = {
  ...OPERATION_OUTPUT,
  documents: {
    type: 'array',
    description: 'Windchill documents',
    items: { type: 'object', properties: DOCUMENT_PROPERTIES },
  },
  pageInfo: {
    type: 'object',
    description: 'OData pagination information',
    properties: {
      count: { type: 'number', description: 'Number of documents in this page' },
      totalCount: { type: 'number', description: 'Total matching documents', nullable: true },
      nextLink: { type: 'string', description: 'URL for the next page', nullable: true },
    },
  },
} satisfies Record<string, ToolOutputProperty>

const AFFECTED_OUTPUT = {
  ...OPERATION_OUTPUT,
  affectedIds: { type: 'array', description: 'Document identifiers affected by the operation' },
  document: {
    type: 'object',
    description: 'Document returned by Windchill when the operation returns one',
    optional: true,
    nullable: true,
    properties: DOCUMENT_PROPERTIES,
  },
  documents: {
    type: 'array',
    description: 'Documents returned by Windchill when the operation returns them',
    optional: true,
    items: { type: 'object', properties: DOCUMENT_PROPERTIES },
  },
} satisfies Record<string, ToolOutputProperty>

const FILE_OUTPUT = {
  ...OPERATION_OUTPUT,
  file: { type: 'file', description: 'Downloaded content stored as a canonical UserFile' },
  fileName: { type: 'string', description: 'Downloaded file name' },
  mimeType: { type: 'string', description: 'Downloaded content MIME type' },
} satisfies Record<string, ToolOutputProperty>

const UPLOAD_OUTPUT = {
  ...OPERATION_OUTPUT,
  affectedIds: { type: 'array', description: 'Document identifiers affected by the upload' },
  uploadedFileNames: { type: 'array', description: 'Names of files accepted by Windchill' },
} satisfies Record<string, ToolOutputProperty>

const PARAM_LIBRARY: Record<keyof WindchillParams, ToolParamDefinition> = {
  baseUrl: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description:
      'Complete versioned Windchill OData root, for example https://host/Windchill/servlet/odata/v6',
  },
  username: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Windchill service-account username',
  },
  password: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Windchill service-account password',
  },
  documentOid: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'WT.Document OID, for example OR:wt.doc.WTDocument:48796581',
  },
  documentOids: {
    type: 'array',
    required: true,
    visibility: 'user-or-llm',
    description: 'WT.Document OIDs to process atomically',
  },
  attachmentOid: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Windchill attachment content OID',
  },
  name: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Document name',
  },
  number: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Optional document number when manual numbering is enabled',
  },
  title: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Document title',
  },
  description: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Document description',
  },
  containerOid: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Container OID in which to create the document',
  },
  folderOid: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Optional folder OID for the new document',
  },
  attributes: {
    type: 'json',
    required: false,
    visibility: 'user-or-llm',
    description: 'Installed Windchill document attributes as a JSON object',
  },
  documents: {
    type: 'json',
    required: true,
    visibility: 'user-or-llm',
    description: 'Document inputs as a JSON array',
  },
  checkOutNote: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Checkout note',
  },
  checkInNote: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Check-in note',
  },
  keepCheckedOut: {
    type: 'boolean',
    required: false,
    visibility: 'user-or-llm',
    description: 'Keep the document checked out after checking it in',
  },
  versionId: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Optional target revision identifier when override-on-revise is enabled',
  },
  stateValue: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Internal value of the target lifecycle state',
  },
  stateDisplay: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Display value of the target lifecycle state',
  },
  securityLabelUpdates: {
    type: 'json',
    required: true,
    visibility: 'user-or-llm',
    description: 'Array of document IDs and installed security-label values',
  },
  primaryFile: {
    type: 'file',
    required: true,
    visibility: 'user-only',
    description: 'Primary content file to upload',
  },
  attachmentFiles: {
    type: 'file[]',
    required: true,
    visibility: 'user-only',
    description: 'Attachment files to upload',
  },
  fileName: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Optional downloaded file name override',
  },
  select: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Comma-separated OData $select properties',
  },
  filter: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'OData $filter expression',
  },
  expand: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'OData $expand expression',
  },
  orderBy: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'OData $orderby expression',
  },
  top: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'Maximum documents to return, from 1 to 200',
  },
  skip: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'Documents to skip',
  },
  count: {
    type: 'boolean',
    required: false,
    visibility: 'user-or-llm',
    description: 'Ask Windchill to include the total matching count',
  },
  latestVersion: {
    type: 'boolean',
    required: false,
    visibility: 'user-or-llm',
    description: 'Return only the latest version of matching documents',
  },
  nextLink: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Verified @odata.nextLink from a previous list response',
  },
  structureDepth: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'Document structure expansion depth, from 1 to 3',
  },
  _context: {
    type: 'json',
    required: false,
    visibility: 'hidden',
    description: 'Workflow execution context',
  },
}

const COMMON_PARAMS = ['baseUrl', 'username', 'password'] as const

export const WINDCHILL_OPERATION_DEFINITIONS: Record<
  WindchillOperation,
  WindchillOperationDefinition
> = {
  windchill_list_documents: {
    name: 'Windchill List Documents',
    description: 'List WT.Document objects with bounded OData query and pagination controls',
    directRead: true,
    params: [
      ...COMMON_PARAMS,
      'select',
      'filter',
      'expand',
      'orderBy',
      'top',
      'skip',
      'count',
      'latestVersion',
      'nextLink',
    ],
    outputs: DOCUMENTS_OUTPUT,
  },
  windchill_get_document: {
    name: 'Windchill Get Document',
    description: 'Get a WT.Document by OID',
    directRead: true,
    params: [...COMMON_PARAMS, 'documentOid', 'select', 'expand'],
    outputs: DOCUMENT_OUTPUT,
  },
  windchill_get_document_structure: {
    name: 'Windchill Get Document Structure',
    description: 'Retrieve document usage links and their parent and child documents',
    directRead: true,
    params: [...COMMON_PARAMS, 'documentOid', 'structureDepth'],
    outputs: {
      ...OPERATION_OUTPUT,
      structure: {
        type: 'array',
        description: 'Document usage links in the requested structure',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Document usage link OID', nullable: true },
            parent: {
              type: 'object',
              description: 'Parent document',
              nullable: true,
              properties: DOCUMENT_PROPERTIES,
            },
            child: {
              type: 'object',
              description: 'Child document',
              nullable: true,
              properties: DOCUMENT_PROPERTIES,
            },
          },
        },
      },
    },
  },
  windchill_get_valid_state_transitions: {
    name: 'Windchill Get Valid State Transitions',
    description: 'Get lifecycle states a document can transition to from its current state',
    directRead: true,
    params: [...COMMON_PARAMS, 'documentOid'],
    outputs: {
      ...OPERATION_OUTPUT,
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
    },
  },
  windchill_get_primary_content: {
    name: 'Windchill Get Primary Content',
    description: 'Get primary-content metadata for a document',
    directRead: true,
    params: [...COMMON_PARAMS, 'documentOid'],
    outputs: {
      ...OPERATION_OUTPUT,
      content: {
        type: 'object',
        description: 'Primary-content metadata',
        nullable: true,
        properties: CONTENT_PROPERTIES,
      },
    },
  },
  windchill_list_attachments: {
    name: 'Windchill List Attachments',
    description: 'List attachment metadata for a document',
    directRead: true,
    params: [...COMMON_PARAMS, 'documentOid'],
    outputs: {
      ...OPERATION_OUTPUT,
      attachments: {
        type: 'array',
        description: 'Document attachments',
        items: { type: 'object', properties: CONTENT_PROPERTIES },
      },
    },
  },
  windchill_create_document: {
    name: 'Windchill Create Document',
    description: 'Create one WT.Document',
    params: [
      ...COMMON_PARAMS,
      'name',
      'containerOid',
      'number',
      'title',
      'description',
      'folderOid',
      'attributes',
    ],
    outputs: AFFECTED_OUTPUT,
  },
  windchill_create_documents: {
    name: 'Windchill Create Documents',
    description: 'Create multiple WT.Document objects atomically',
    params: [...COMMON_PARAMS, 'documents'],
    outputs: AFFECTED_OUTPUT,
  },
  windchill_update_document: {
    name: 'Windchill Update Document',
    description: 'Update attributes on one document',
    params: [...COMMON_PARAMS, 'documentOid', 'attributes'],
    outputs: AFFECTED_OUTPUT,
  },
  windchill_update_documents: {
    name: 'Windchill Update Documents',
    description: 'Update multiple documents atomically',
    params: [...COMMON_PARAMS, 'documents'],
    outputs: AFFECTED_OUTPUT,
  },
  windchill_delete_document: {
    name: 'Windchill Delete Document',
    description: 'Delete one document',
    params: [...COMMON_PARAMS, 'documentOid'],
    outputs: AFFECTED_OUTPUT,
  },
  windchill_delete_documents: {
    name: 'Windchill Delete Documents',
    description: 'Delete multiple documents atomically',
    params: [...COMMON_PARAMS, 'documentOids'],
    outputs: AFFECTED_OUTPUT,
  },
  windchill_check_out_document: {
    name: 'Windchill Check Out Document',
    description: 'Check out one document',
    params: [...COMMON_PARAMS, 'documentOid', 'checkOutNote'],
    outputs: AFFECTED_OUTPUT,
  },
  windchill_check_out_documents: {
    name: 'Windchill Check Out Documents',
    description: 'Check out multiple documents atomically',
    params: [...COMMON_PARAMS, 'documentOids', 'checkOutNote'],
    outputs: AFFECTED_OUTPUT,
  },
  windchill_check_in_document: {
    name: 'Windchill Check In Document',
    description: 'Check in one document',
    params: [...COMMON_PARAMS, 'documentOid', 'checkInNote', 'keepCheckedOut', 'checkOutNote'],
    outputs: AFFECTED_OUTPUT,
  },
  windchill_check_in_documents: {
    name: 'Windchill Check In Documents',
    description: 'Check in multiple documents atomically',
    params: [...COMMON_PARAMS, 'documentOids', 'checkInNote', 'keepCheckedOut', 'checkOutNote'],
    outputs: AFFECTED_OUTPUT,
  },
  windchill_undo_check_out_document: {
    name: 'Windchill Undo Check Out Document',
    description: 'Undo checkout for one document',
    params: [...COMMON_PARAMS, 'documentOid'],
    outputs: AFFECTED_OUTPUT,
  },
  windchill_undo_check_out_documents: {
    name: 'Windchill Undo Check Out Documents',
    description: 'Undo checkout for multiple documents atomically',
    params: [...COMMON_PARAMS, 'documentOids'],
    outputs: AFFECTED_OUTPUT,
  },
  windchill_revise_document: {
    name: 'Windchill Revise Document',
    description: 'Create a new revision of one document',
    params: [...COMMON_PARAMS, 'documentOid', 'versionId'],
    outputs: AFFECTED_OUTPUT,
  },
  windchill_revise_documents: {
    name: 'Windchill Revise Documents',
    description: 'Create new revisions of multiple documents atomically',
    params: [...COMMON_PARAMS, 'documentOids', 'versionId'],
    outputs: AFFECTED_OUTPUT,
  },
  windchill_set_lifecycle_state: {
    name: 'Windchill Set Lifecycle State',
    description: 'Transition a document to a valid lifecycle state',
    params: [...COMMON_PARAMS, 'documentOid', 'stateValue', 'stateDisplay'],
    outputs: AFFECTED_OUTPUT,
  },
  windchill_update_document_security_labels: {
    name: 'Windchill Update Document Security Labels',
    description: 'Update installed security-label attributes for one or more documents',
    params: [...COMMON_PARAMS, 'securityLabelUpdates'],
    outputs: AFFECTED_OUTPUT,
  },
  windchill_download_primary_content: {
    name: 'Windchill Download Primary Content',
    description: 'Download primary content into a canonical UserFile',
    params: [...COMMON_PARAMS, 'documentOid', 'fileName'],
    outputs: FILE_OUTPUT,
  },
  windchill_upload_primary_content: {
    name: 'Windchill Upload Primary Content',
    description: 'Upload or replace a document primary-content file',
    params: [...COMMON_PARAMS, 'documentOid', 'primaryFile'],
    outputs: UPLOAD_OUTPUT,
  },
  windchill_download_attachment: {
    name: 'Windchill Download Attachment',
    description: 'Download a document attachment into a canonical UserFile',
    params: [...COMMON_PARAMS, 'documentOid', 'attachmentOid', 'fileName'],
    outputs: FILE_OUTPUT,
  },
  windchill_upload_attachments: {
    name: 'Windchill Upload Attachments',
    description: 'Upload one or more files as document attachments',
    params: [...COMMON_PARAMS, 'documentOid', 'attachmentFiles'],
    outputs: UPLOAD_OUTPUT,
  },
}

function stringValue(record: Record<string, unknown>, key: string): string | null {
  return typeof record[key] === 'string' ? record[key] : null
}

function numberValue(record: Record<string, unknown>, key: string): number | null {
  const value = record[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function booleanValue(record: Record<string, unknown>, key: string): boolean | null {
  return typeof record[key] === 'boolean' ? record[key] : null
}

export function normalizeWindchillDocument(value: unknown): WindchillDocument | null {
  if (!isRecordLike(value)) return null
  return {
    id: stringValue(value, 'ID'),
    name: stringValue(value, 'Name'),
    number: stringValue(value, 'Number'),
    title: stringValue(value, 'Title'),
    description: stringValue(value, 'Description'),
    state: stringValue(value, 'State'),
    versionId: stringValue(value, 'VersionID'),
    revision: stringValue(value, 'Revision'),
    version: stringValue(value, 'Version'),
    latest: booleanValue(value, 'Latest'),
    checkoutState: stringValue(value, 'CheckoutState'),
    folderName: stringValue(value, 'FolderName'),
    folderLocation: stringValue(value, 'FolderLocation'),
  }
}

export function normalizeWindchillContent(value: unknown): WindchillContent | null {
  if (!isRecordLike(value)) return null
  return {
    id: stringValue(value, 'ID'),
    fileName: stringValue(value, 'FileName'),
    description: stringValue(value, 'Description'),
    format: stringValue(value, 'Format'),
    mimeType: stringValue(value, 'MimeType'),
    fileSize: numberValue(value, 'FileSize'),
  }
}

export function sanitizeWindchillError(message: string): string {
  return message
    .replace(/https?:\/\/\S+/gi, '[redacted URL]')
    .replace(/\b(?:CSRF_NONCE|NonceValue|NonceKey)\b\s*[:=]\s*\S+/gi, '[redacted nonce]')
    .replace(/\bBasic\s+[A-Za-z0-9+/=]+/gi, 'Basic [redacted]')
    .slice(0, 4096)
}

function collection(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (isRecordLike(value) && Array.isArray(value.value)) return value.value
  return []
}

function normalizeState(value: unknown): WindchillStateTransition | null {
  if (!isRecordLike(value)) return null
  return {
    value: stringValue(value, 'Value'),
    display: stringValue(value, 'Display'),
  }
}

function normalizeUsageLink(value: unknown): WindchillDocumentUsageLink | null {
  if (!isRecordLike(value)) return null
  return {
    id: stringValue(value, 'ID'),
    parent: normalizeWindchillDocument(value.DocUsedBy),
    child: normalizeWindchillDocument(value.DocUses),
  }
}

export function normalizeWindchillDocuments(value: unknown): WindchillDocument[] {
  return collection(value)
    .map(normalizeWindchillDocument)
    .filter((document): document is WindchillDocument => document !== null)
}

export function windchillPageInfo(value: unknown, pageCount: number) {
  const record = isRecordLike(value) ? value : {}
  return {
    count: pageCount,
    totalCount: numberValue(record, '@odata.count'),
    nextLink: stringValue(record, '@odata.nextLink'),
  }
}

export function normalizeServiceRoot(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  const parsed = new URL(trimmed)
  if (parsed.protocol !== 'https:') throw new Error('Windchill base URL must use HTTPS')
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Windchill base URL must not include credentials, query parameters, or a hash')
  }
  if (!/\/servlet\/odata\/v\d+$/i.test(parsed.pathname)) {
    throw new Error('Windchill base URL must end with a versioned /servlet/odata/vN path')
  }
  return parsed.toString().replace(/\/$/, '')
}

export function createBasicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
}

export function encodeWindchillOid(oid: string): string {
  const trimmed = oid.trim()
  if (!/^[A-Za-z0-9_.:-]+$/.test(trimmed)) {
    throw new Error('Windchill OID contains unsupported characters')
  }
  return encodeURIComponent(trimmed)
}

function documentPath(baseUrl: string, oid: string): string {
  return `${normalizeServiceRoot(baseUrl)}/DocMgmt/Documents('${encodeWindchillOid(oid)}')`
}

export function resolveWindchillNextLink(baseUrl: string, nextLink: string): string {
  const serviceRoot = new URL(normalizeServiceRoot(baseUrl))
  const resolved = new URL(nextLink, serviceRoot)
  const rootPath = `${serviceRoot.pathname}/`
  if (resolved.protocol !== 'https:' || resolved.origin !== serviceRoot.origin) {
    throw new Error('Windchill nextLink must remain on the configured HTTPS origin')
  }
  if (!resolved.pathname.startsWith(rootPath)) {
    throw new Error('Windchill nextLink must remain under the configured service root')
  }
  return resolved.toString()
}

function structureExpand(depth: number): string {
  let child = 'DocUses'
  for (let level = 1; level < depth; level += 1) {
    child = `DocUses($expand=DocUsageLinks($expand=${child}))`
  }
  return `DocUsedBy,${child}`
}

function integerInRange(value: number, field: string, minimum: number, maximum?: number): number {
  if (!Number.isInteger(value) || value < minimum || (maximum !== undefined && value > maximum)) {
    const range =
      maximum === undefined ? `at least ${minimum}` : `between ${minimum} and ${maximum}`
    throw new Error(`Windchill ${field} must be an integer ${range}`)
  }
  return value
}

export function buildWindchillReadUrl(
  operation: WindchillOperation,
  params: WindchillParams
): string {
  const root = normalizeServiceRoot(params.baseUrl)
  if (operation === 'windchill_list_documents') {
    if (params.nextLink) return resolveWindchillNextLink(root, params.nextLink)
    const url = new URL(`${root}/DocMgmt/Documents`)
    if (params.select) url.searchParams.set('$select', params.select.trim())
    if (params.filter) url.searchParams.set('$filter', params.filter.trim())
    if (params.expand) url.searchParams.set('$expand', params.expand.trim())
    if (params.orderBy) url.searchParams.set('$orderby', params.orderBy.trim())
    if (params.top !== undefined) {
      url.searchParams.set('$top', String(integerInRange(params.top, 'top', 1, 200)))
    }
    if (params.skip !== undefined) {
      url.searchParams.set('$skip', String(integerInRange(params.skip, 'skip', 0)))
    }
    if (params.count !== undefined) url.searchParams.set('$count', String(params.count))
    if (params.latestVersion !== undefined) {
      url.searchParams.set('ptc.search.latestversion', String(params.latestVersion))
    }
    return url.toString()
  }

  if (!params.documentOid) throw new Error('Document OID is required')
  const path = documentPath(root, params.documentOid)
  if (operation === 'windchill_get_document') {
    const url = new URL(path)
    if (params.select) url.searchParams.set('$select', params.select.trim())
    if (params.expand) url.searchParams.set('$expand', params.expand.trim())
    return url.toString()
  }
  if (operation === 'windchill_get_document_structure') {
    const depth = integerInRange(params.structureDepth ?? 1, 'structureDepth', 1, 3)
    const url = new URL(`${path}/DocUsageLinks`)
    url.searchParams.set('$expand', structureExpand(depth))
    return url.toString()
  }
  if (operation === 'windchill_get_valid_state_transitions') {
    return `${path}/PTC.DocMgmt.GetValidStateTransitions()`
  }
  if (operation === 'windchill_get_primary_content') return `${path}/PrimaryContent`
  if (operation === 'windchill_list_attachments') return `${path}/Attachments`
  throw new Error(`Operation ${operation} is not a direct Windchill read`)
}

export function normalizeWindchillReadOutput(
  operation: WindchillOperation,
  value: unknown
): WindchillOutput {
  if (operation === 'windchill_list_documents') {
    const documents = normalizeWindchillDocuments(value)
    return { operation, documents, pageInfo: windchillPageInfo(value, documents.length) }
  }
  if (operation === 'windchill_get_document') {
    return { operation, document: normalizeWindchillDocument(value) }
  }
  if (operation === 'windchill_get_document_structure') {
    const structure = collection(value)
      .map(normalizeUsageLink)
      .filter((link): link is WindchillDocumentUsageLink => link !== null)
    return { operation, structure }
  }
  if (operation === 'windchill_get_valid_state_transitions') {
    const states = collection(value)
      .map(normalizeState)
      .filter((state): state is WindchillStateTransition => state !== null)
    return { operation, states }
  }
  if (operation === 'windchill_get_primary_content') {
    const first = collection(value)[0]
    return { operation, content: normalizeWindchillContent(first ?? value) }
  }
  if (operation === 'windchill_list_attachments') {
    const attachments = collection(value)
      .map(normalizeWindchillContent)
      .filter((content): content is WindchillContent => content !== null)
    return { operation, attachments }
  }
  throw new Error(`Operation ${operation} does not have a direct-read response transform`)
}

function operationParams(definition: WindchillOperationDefinition) {
  return Object.fromEntries(definition.params.map((key) => [key, PARAM_LIBRARY[key]]))
}

function internalBody(operation: WindchillOperation, params: WindchillParams) {
  const { _context, ...input } = params
  return {
    ...input,
    operation,
    workspaceId: typeof _context?.workspaceId === 'string' ? _context.workspaceId : undefined,
    workflowId: typeof _context?.workflowId === 'string' ? _context.workflowId : undefined,
    executionId: typeof _context?.executionId === 'string' ? _context.executionId : undefined,
  }
}

function providerError(value: unknown, fallback: string): string {
  if (!isRecordLike(value)) return fallback
  if (typeof value.message === 'string') return value.message
  if (isRecordLike(value.error)) {
    if (typeof value.error.message === 'string') return value.error.message
    if (isRecordLike(value.error.message) && typeof value.error.message.value === 'string') {
      return value.error.message.value
    }
  }
  return fallback
}

async function transformDirectRead(
  operation: WindchillOperation,
  response: Response
): Promise<WindchillResponse> {
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(
      sanitizeWindchillError(
        providerError(data, `Windchill request failed with status ${response.status}`)
      )
    )
  }
  return { success: true, output: normalizeWindchillReadOutput(operation, data) }
}

async function transformInternalResponse(
  operation: WindchillOperation,
  response: Response
): Promise<WindchillResponse> {
  try {
    const data: unknown = await response.json()
    const parsed = windchillOperationResponseSchema.safeParse(data)
    if (!parsed.success) {
      return {
        success: false,
        output: { operation },
        error: 'Windchill route returned an invalid response',
      }
    }
    if (!response.ok || !parsed.data.success) {
      return {
        success: false,
        output: { operation },
        error:
          parsed.data.success === false
            ? sanitizeWindchillError(parsed.data.error)
            : `Windchill request failed with status ${response.status}`,
      }
    }
    const result: WindchillOperationResponse = parsed.data
    return { success: true, output: result.output }
  } catch (error) {
    return {
      success: false,
      output: { operation },
      error: sanitizeWindchillError(
        getErrorMessage(error, 'Failed to read Windchill route response')
      ),
    }
  }
}

export function createWindchillTool(
  operation: WindchillOperation
): ToolConfig<WindchillParams, WindchillResponse> {
  const definition = WINDCHILL_OPERATION_DEFINITIONS[operation]
  const request = definition.directRead
    ? {
        url: (params: WindchillParams) => buildWindchillReadUrl(operation, params),
        method: 'GET' as const,
        headers: (params: WindchillParams) => ({
          Authorization: createBasicAuthHeader(params.username, params.password),
          Accept: 'application/json',
        }),
        stripAuthOnRedirect: true,
        retry: { enabled: true, maxRetries: 2, retryIdempotentOnly: true },
      }
    : {
        url: '/api/tools/windchill',
        method: 'POST' as const,
        headers: () => ({ 'Content-Type': 'application/json' }),
        body: (params: WindchillParams) => internalBody(operation, params),
        internalAuth: 'executor_delegation' as const,
      }

  return {
    id: operation,
    name: definition.name,
    description: definition.description,
    version: '1.0.0',
    params: operationParams(definition),
    request,
    transformResponse: (response) =>
      definition.directRead
        ? transformDirectRead(operation, response)
        : transformInternalResponse(operation, response),
    outputs: definition.outputs,
  }
}
