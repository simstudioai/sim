import { getErrorMessage } from '@sim/utils/errors'
import { DocumentIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { WindchillResponse } from '@/tools/windchill/types'

const SINGLE_DOCUMENT_OPERATIONS = [
  'windchill_get_document',
  'windchill_get_document_structure',
  'windchill_get_valid_state_transitions',
  'windchill_get_primary_content',
  'windchill_list_attachments',
  'windchill_update_document',
  'windchill_delete_document',
  'windchill_check_out_document',
  'windchill_check_in_document',
  'windchill_undo_check_out_document',
  'windchill_revise_document',
  'windchill_set_lifecycle_state',
  'windchill_download_primary_content',
  'windchill_upload_primary_content',
  'windchill_download_attachment',
  'windchill_upload_attachments',
]

const BULK_DOCUMENT_OPERATIONS = [
  'windchill_delete_documents',
  'windchill_check_out_documents',
  'windchill_check_in_documents',
  'windchill_undo_check_out_documents',
  'windchill_revise_documents',
]

const CHECK_OUT_OPERATIONS = [
  'windchill_check_out_document',
  'windchill_check_out_documents',
  'windchill_check_in_document',
  'windchill_check_in_documents',
]

const CHECK_IN_OPERATIONS = ['windchill_check_in_document', 'windchill_check_in_documents']

const REVISE_OPERATIONS = ['windchill_revise_document', 'windchill_revise_documents']

const DOWNLOAD_OPERATIONS = ['windchill_download_primary_content', 'windchill_download_attachment']

const PRIMARY_FILE_FIELD = ['primaryFileUpload', 'primaryFileReference'] as const
const ATTACHMENT_FILES_FIELD = ['attachmentFilesUpload', 'attachmentFilesReference'] as const

function parseJsonField(value: unknown, field: string, expected: 'array' | 'object'): unknown {
  if (value === undefined || value === null || value === '') return undefined

  let parsed = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch (error) {
      throw new Error(`Invalid JSON in "${field}": ${getErrorMessage(error, 'unknown error')}`)
    }
  }

  if (expected === 'array' && !Array.isArray(parsed)) {
    throw new Error(`"${field}" must be a JSON array`)
  }
  if (
    expected === 'object' &&
    (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
  ) {
    throw new Error(`"${field}" must be a JSON object`)
  }

  return parsed
}

function coerceNumber(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const number = Number(value)
  if (!Number.isFinite(number)) throw new Error(`"${field}" must be a valid number`)
  return number
}

function coerceBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  throw new Error('Boolean values must be true or false')
}

export const WindchillBlock: BlockConfig<WindchillResponse> = {
  type: 'windchill',
  name: 'Windchill',
  description: 'Manage WT.Document objects and content in PTC Windchill',
  longDescription:
    'Integrate PTC Windchill document management into your workflow. Read and update WT.Document metadata, perform version and lifecycle actions, and transfer primary content and attachments.',
  docsLink: 'https://docs.sim.ai/integrations/windchill',
  category: 'tools',
  integrationType: IntegrationType.Documents,
  authMode: AuthMode.ApiKey,
  bgColor: '#4B5563',
  icon: DocumentIcon,
  canvasPresentation: {
    defaultTitle: 'Windchill',
    operationSubBlockId: 'operation',
    sentences: {
      byOperation: {
        windchill_list_documents: [
          'List documents',
          { text: 'matching', field: 'filter' },
          { text: ', up to', field: 'top', after: 'per page' },
        ],
        windchill_get_document: [{ text: 'Get document', field: 'documentOid', core: true }],
        windchill_get_document_structure: [
          { text: 'Get structure for document', field: 'documentOid', core: true },
        ],
        windchill_get_valid_state_transitions: [
          { text: 'Get valid states for document', field: 'documentOid', core: true },
        ],
        windchill_get_primary_content: [
          { text: 'Get primary content for document', field: 'documentOid', core: true },
        ],
        windchill_list_attachments: [
          { text: 'List attachments on document', field: 'documentOid', core: true },
        ],
        windchill_create_document: [
          { text: 'Create document', field: 'name', core: true },
          { text: 'in container', field: 'containerOid' },
        ],
        windchill_create_documents: [{ text: 'Create documents', field: 'documents', core: true }],
        windchill_update_document: [
          { text: 'Update document', field: 'documentOid', core: true },
          { text: 'with', field: 'attributes' },
        ],
        windchill_update_documents: [{ text: 'Update documents', field: 'documents', core: true }],
        windchill_delete_document: [{ text: 'Delete document', field: 'documentOid', core: true }],
        windchill_delete_documents: [
          { text: 'Delete documents', field: 'documentOids', core: true },
        ],
        windchill_check_out_document: [
          { text: 'Check out document', field: 'documentOid', core: true },
        ],
        windchill_check_out_documents: [
          { text: 'Check out documents', field: 'documentOids', core: true },
        ],
        windchill_check_in_document: [
          { text: 'Check in document', field: 'documentOid', core: true },
        ],
        windchill_check_in_documents: [
          { text: 'Check in documents', field: 'documentOids', core: true },
        ],
        windchill_undo_check_out_document: [
          { text: 'Undo checkout for document', field: 'documentOid', core: true },
        ],
        windchill_undo_check_out_documents: [
          { text: 'Undo checkout for documents', field: 'documentOids', core: true },
        ],
        windchill_revise_document: [{ text: 'Revise document', field: 'documentOid', core: true }],
        windchill_revise_documents: [
          { text: 'Revise documents', field: 'documentOids', core: true },
        ],
        windchill_set_lifecycle_state: [
          { text: 'Set document', field: 'documentOid', core: true },
          { text: 'to lifecycle state', field: 'stateDisplay', core: true },
        ],
        windchill_update_document_security_labels: [
          { text: 'Update security labels', field: 'securityLabelUpdates', core: true },
        ],
        windchill_download_primary_content: [
          { text: 'Download primary content from', field: 'documentOid', core: true },
        ],
        windchill_upload_primary_content: [
          { text: 'Upload', field: PRIMARY_FILE_FIELD, core: true },
          { text: 'as primary content on', field: 'documentOid' },
        ],
        windchill_download_attachment: [
          { text: 'Download attachment', field: 'attachmentOid', core: true },
          { text: 'from document', field: 'documentOid' },
        ],
        windchill_upload_attachments: [
          { text: 'Upload', field: ATTACHMENT_FILES_FIELD, core: true },
          { text: 'as attachments on', field: 'documentOid' },
        ],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Documents', id: 'windchill_list_documents' },
        { label: 'Get Document', id: 'windchill_get_document' },
        { label: 'Get Document Structure', id: 'windchill_get_document_structure' },
        {
          label: 'Get Valid State Transitions',
          id: 'windchill_get_valid_state_transitions',
        },
        { label: 'Get Primary Content', id: 'windchill_get_primary_content' },
        { label: 'List Attachments', id: 'windchill_list_attachments' },
        { label: 'Create Document', id: 'windchill_create_document' },
        { label: 'Create Documents', id: 'windchill_create_documents' },
        { label: 'Update Document', id: 'windchill_update_document' },
        { label: 'Update Documents', id: 'windchill_update_documents' },
        { label: 'Delete Document', id: 'windchill_delete_document' },
        { label: 'Delete Documents', id: 'windchill_delete_documents' },
        { label: 'Check Out Document', id: 'windchill_check_out_document' },
        { label: 'Check Out Documents', id: 'windchill_check_out_documents' },
        { label: 'Check In Document', id: 'windchill_check_in_document' },
        { label: 'Check In Documents', id: 'windchill_check_in_documents' },
        { label: 'Undo Check Out Document', id: 'windchill_undo_check_out_document' },
        { label: 'Undo Check Out Documents', id: 'windchill_undo_check_out_documents' },
        { label: 'Revise Document', id: 'windchill_revise_document' },
        { label: 'Revise Documents', id: 'windchill_revise_documents' },
        { label: 'Set Lifecycle State', id: 'windchill_set_lifecycle_state' },
        {
          label: 'Update Document Security Labels',
          id: 'windchill_update_document_security_labels',
        },
        { label: 'Download Primary Content', id: 'windchill_download_primary_content' },
        { label: 'Upload Primary Content', id: 'windchill_upload_primary_content' },
        { label: 'Download Attachment', id: 'windchill_download_attachment' },
        { label: 'Upload Attachments', id: 'windchill_upload_attachments' },
      ],
      value: () => 'windchill_list_documents',
    },
    {
      id: 'baseUrl',
      title: 'Service Root',
      type: 'short-input',
      placeholder: 'https://host/Windchill/servlet/odata/v6',
      required: true,
      description: 'Complete versioned HTTPS Windchill OData service root',
    },
    {
      id: 'username',
      title: 'Username',
      type: 'short-input',
      placeholder: 'Windchill username',
      required: true,
    },
    {
      id: 'password',
      title: 'Password',
      type: 'short-input',
      placeholder: 'Windchill password',
      password: true,
      required: true,
    },
    {
      id: 'documentOid',
      title: 'Document OID',
      type: 'short-input',
      placeholder: 'OR:wt.doc.WTDocument:48796581',
      condition: { field: 'operation', value: SINGLE_DOCUMENT_OPERATIONS },
      required: true,
    },
    {
      id: 'documentOids',
      title: 'Document OIDs',
      type: 'code',
      language: 'json',
      placeholder: '["OR:wt.doc.WTDocument:48796581"]',
      condition: { field: 'operation', value: BULK_DOCUMENT_OPERATIONS },
      required: true,
    },
    {
      id: 'attachmentOid',
      title: 'Attachment OID',
      type: 'short-input',
      placeholder: 'OR:wt.content.ApplicationData:48796600',
      condition: { field: 'operation', value: 'windchill_download_attachment' },
      required: true,
    },
    {
      id: 'name',
      title: 'Name',
      type: 'short-input',
      placeholder: 'Document name',
      condition: { field: 'operation', value: 'windchill_create_document' },
      required: true,
    },
    {
      id: 'containerOid',
      title: 'Container OID',
      type: 'short-input',
      placeholder: 'OR:wt.pdmlink.PDMLinkProduct:12345',
      condition: { field: 'operation', value: 'windchill_create_document' },
      required: true,
    },
    {
      id: 'number',
      title: 'Number',
      type: 'short-input',
      placeholder: 'Optional document number',
      condition: { field: 'operation', value: 'windchill_create_document' },
      mode: 'advanced',
    },
    {
      id: 'title',
      title: 'Title',
      type: 'short-input',
      placeholder: 'Optional title',
      condition: { field: 'operation', value: 'windchill_create_document' },
    },
    {
      id: 'description',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Optional description',
      condition: { field: 'operation', value: 'windchill_create_document' },
    },
    {
      id: 'folderOid',
      title: 'Folder OID',
      type: 'short-input',
      placeholder: 'Optional target folder OID',
      condition: { field: 'operation', value: 'windchill_create_document' },
      mode: 'advanced',
    },
    {
      id: 'attributes',
      title: 'Attributes',
      type: 'code',
      language: 'json',
      placeholder: '{"Title":"Updated title"}',
      condition: {
        field: 'operation',
        value: ['windchill_create_document', 'windchill_update_document'],
      },
      required: { field: 'operation', value: 'windchill_update_document' },
    },
    {
      id: 'documents',
      title: 'Documents',
      type: 'code',
      language: 'json',
      placeholder: '[{"name":"Document","containerOid":"OR:wt.pdmlink.PDMLinkProduct:12345"}]',
      condition: {
        field: 'operation',
        value: ['windchill_create_documents', 'windchill_update_documents'],
      },
      required: true,
    },
    {
      id: 'checkOutNote',
      title: 'Check Out Note',
      type: 'long-input',
      placeholder: 'Optional checkout note',
      condition: { field: 'operation', value: CHECK_OUT_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'checkInNote',
      title: 'Check In Note',
      type: 'long-input',
      placeholder: 'Optional check-in note',
      condition: { field: 'operation', value: CHECK_IN_OPERATIONS },
    },
    {
      id: 'keepCheckedOut',
      title: 'Keep Checked Out',
      type: 'switch',
      condition: { field: 'operation', value: CHECK_IN_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'versionId',
      title: 'Version ID',
      type: 'short-input',
      placeholder: 'Optional target revision',
      condition: { field: 'operation', value: REVISE_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'stateValue',
      title: 'State Value',
      type: 'short-input',
      placeholder: 'RELEASED',
      condition: { field: 'operation', value: 'windchill_set_lifecycle_state' },
      required: true,
    },
    {
      id: 'stateDisplay',
      title: 'State Display',
      type: 'short-input',
      placeholder: 'Released',
      condition: { field: 'operation', value: 'windchill_set_lifecycle_state' },
      required: true,
    },
    {
      id: 'securityLabelUpdates',
      title: 'Security Label Updates',
      type: 'code',
      language: 'json',
      placeholder: '[{"id":"OR:wt.doc.WTDocument:48796581","labels":{"EXPORT_CONTROL":"L1"}}]',
      condition: {
        field: 'operation',
        value: 'windchill_update_document_security_labels',
      },
      required: true,
    },
    {
      id: 'select',
      title: 'Select',
      type: 'short-input',
      placeholder: 'ID,Name,Number,State',
      condition: {
        field: 'operation',
        value: ['windchill_list_documents', 'windchill_get_document'],
      },
      mode: 'advanced',
    },
    {
      id: 'filter',
      title: 'Filter',
      type: 'short-input',
      placeholder: "State eq 'RELEASED'",
      condition: { field: 'operation', value: 'windchill_list_documents' },
      mode: 'advanced',
    },
    {
      id: 'expand',
      title: 'Expand',
      type: 'short-input',
      placeholder: 'PrimaryContent',
      condition: {
        field: 'operation',
        value: ['windchill_list_documents', 'windchill_get_document'],
      },
      mode: 'advanced',
    },
    {
      id: 'orderBy',
      title: 'Order By',
      type: 'short-input',
      placeholder: 'Name asc',
      condition: { field: 'operation', value: 'windchill_list_documents' },
      mode: 'advanced',
    },
    {
      id: 'top',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '100',
      condition: { field: 'operation', value: 'windchill_list_documents' },
      mode: 'advanced',
    },
    {
      id: 'skip',
      title: 'Skip',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: 'windchill_list_documents' },
      mode: 'advanced',
    },
    {
      id: 'count',
      title: 'Include Count',
      type: 'switch',
      condition: { field: 'operation', value: 'windchill_list_documents' },
      mode: 'advanced',
    },
    {
      id: 'latestVersion',
      title: 'Latest Version Only',
      type: 'switch',
      condition: { field: 'operation', value: 'windchill_list_documents' },
      mode: 'advanced',
    },
    {
      id: 'nextLink',
      title: 'Next Page URL',
      type: 'short-input',
      placeholder: '@odata.nextLink from the previous result',
      condition: { field: 'operation', value: 'windchill_list_documents' },
      mode: 'advanced',
    },
    {
      id: 'structureDepth',
      title: 'Structure Depth',
      type: 'short-input',
      placeholder: '1',
      condition: { field: 'operation', value: 'windchill_get_document_structure' },
      mode: 'advanced',
    },
    {
      id: 'fileName',
      title: 'File Name',
      type: 'short-input',
      placeholder: 'Optional downloaded file name',
      condition: { field: 'operation', value: DOWNLOAD_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'primaryFileUpload',
      title: 'Primary Content',
      type: 'file-upload',
      canonicalParamId: 'primaryFile',
      placeholder: 'Upload primary-content file',
      condition: { field: 'operation', value: 'windchill_upload_primary_content' },
      mode: 'basic',
      multiple: false,
      required: true,
    },
    {
      id: 'primaryFileReference',
      title: 'Primary Content',
      type: 'short-input',
      canonicalParamId: 'primaryFile',
      placeholder: 'Reference a file from a previous block',
      condition: { field: 'operation', value: 'windchill_upload_primary_content' },
      mode: 'advanced',
      required: true,
    },
    {
      id: 'attachmentFilesUpload',
      title: 'Attachments',
      type: 'file-upload',
      canonicalParamId: 'attachmentFiles',
      placeholder: 'Upload up to 10 attachment files',
      condition: { field: 'operation', value: 'windchill_upload_attachments' },
      mode: 'basic',
      multiple: true,
      required: true,
    },
    {
      id: 'attachmentFilesReference',
      title: 'Attachments',
      type: 'short-input',
      canonicalParamId: 'attachmentFiles',
      placeholder: 'Reference files from a previous block',
      condition: { field: 'operation', value: 'windchill_upload_attachments' },
      mode: 'advanced',
      required: true,
    },
  ],
  tools: {
    access: [
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
    ],
    config: {
      tool: (params) => params.operation,
      params: (params) => {
        const {
          operation,
          documents,
          attributes,
          documentOids,
          securityLabelUpdates,
          primaryFile,
          attachmentFiles,
          top,
          skip,
          structureDepth,
          count,
          latestVersion,
          keepCheckedOut,
          ...rest
        } = params

        return {
          ...rest,
          ...(documents === undefined || documents === ''
            ? {}
            : { documents: parseJsonField(documents, 'documents', 'array') }),
          ...(attributes === undefined || attributes === ''
            ? {}
            : { attributes: parseJsonField(attributes, 'attributes', 'object') }),
          ...(documentOids === undefined || documentOids === ''
            ? {}
            : { documentOids: parseJsonField(documentOids, 'documentOids', 'array') }),
          ...(securityLabelUpdates === undefined || securityLabelUpdates === ''
            ? {}
            : {
                securityLabelUpdates: parseJsonField(
                  securityLabelUpdates,
                  'securityLabelUpdates',
                  'array'
                ),
              }),
          ...(primaryFile
            ? { primaryFile: normalizeFileInput(primaryFile, { single: true }) }
            : {}),
          ...(attachmentFiles ? { attachmentFiles: normalizeFileInput(attachmentFiles) } : {}),
          ...(top === undefined || top === '' ? {} : { top: coerceNumber(top, 'top') }),
          ...(skip === undefined || skip === '' ? {} : { skip: coerceNumber(skip, 'skip') }),
          ...(structureDepth === undefined || structureDepth === ''
            ? {}
            : { structureDepth: coerceNumber(structureDepth, 'structureDepth') }),
          ...(count === undefined || count === '' ? {} : { count: coerceBoolean(count) }),
          ...(latestVersion === undefined || latestVersion === ''
            ? {}
            : { latestVersion: coerceBoolean(latestVersion) }),
          ...(keepCheckedOut === undefined || keepCheckedOut === ''
            ? {}
            : { keepCheckedOut: coerceBoolean(keepCheckedOut) }),
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    baseUrl: { type: 'string', description: 'Complete versioned Windchill OData service root' },
    username: { type: 'string', description: 'Windchill username' },
    password: { type: 'string', description: 'Windchill password' },
    documentOid: { type: 'string', description: 'WT.Document OID' },
    documentOids: { type: 'array', description: 'WT.Document OIDs' },
    attachmentOid: { type: 'string', description: 'Attachment content OID' },
    name: { type: 'string', description: 'Document name' },
    number: { type: 'string', description: 'Document number' },
    title: { type: 'string', description: 'Document title' },
    description: { type: 'string', description: 'Document description' },
    containerOid: { type: 'string', description: 'Container OID' },
    folderOid: { type: 'string', description: 'Folder OID' },
    attributes: { type: 'json', description: 'Document attributes' },
    documents: { type: 'json', description: 'Bulk document inputs' },
    checkOutNote: { type: 'string', description: 'Checkout note' },
    checkInNote: { type: 'string', description: 'Check-in note' },
    keepCheckedOut: { type: 'boolean', description: 'Keep document checked out after check-in' },
    versionId: { type: 'string', description: 'Target revision identifier' },
    stateValue: { type: 'string', description: 'Internal lifecycle state value' },
    stateDisplay: { type: 'string', description: 'Displayed lifecycle state value' },
    securityLabelUpdates: { type: 'json', description: 'Security-label updates' },
    select: { type: 'string', description: 'OData select expression' },
    filter: { type: 'string', description: 'OData filter expression' },
    expand: { type: 'string', description: 'OData expand expression' },
    orderBy: { type: 'string', description: 'OData order-by expression' },
    top: { type: 'number', description: 'OData page size' },
    skip: { type: 'number', description: 'OData result offset' },
    count: { type: 'boolean', description: 'Whether to include the OData count' },
    latestVersion: { type: 'boolean', description: 'Whether to return only latest versions' },
    nextLink: { type: 'string', description: 'Next-page URL from a prior result' },
    structureDepth: { type: 'number', description: 'Document structure expansion depth' },
    fileName: { type: 'string', description: 'Optional downloaded file name' },
    primaryFile: { type: 'file', description: 'Primary content file' },
    attachmentFiles: { type: 'array', description: 'Attachment files' },
  },
  outputs: {
    operation: { type: 'string', description: 'Windchill operation that was executed' },
    document: { type: 'json', description: 'Windchill document' },
    documents: { type: 'json', description: 'Windchill documents' },
    structure: { type: 'json', description: 'Document structure links' },
    states: { type: 'json', description: 'Valid lifecycle states' },
    content: { type: 'json', description: 'Primary-content metadata' },
    attachments: { type: 'json', description: 'Attachment metadata' },
    pageInfo: { type: 'json', description: 'OData pagination information' },
    affectedIds: { type: 'array', description: 'Affected document identifiers' },
    uploadedFileNames: { type: 'array', description: 'Uploaded file names' },
    file: { type: 'file', description: 'Downloaded file' },
    fileName: { type: 'string', description: 'Downloaded file name' },
    mimeType: { type: 'string', description: 'Downloaded content MIME type' },
  },
}

export const WindchillBlockMeta = {
  tags: ['content-management', 'document-processing'],
  url: 'https://www.ptc.com/en/products/windchill',
  templates: [
    {
      icon: DocumentIcon,
      title: 'Windchill document approval intake',
      prompt:
        'Build a workflow that creates a Windchill document from an approved intake form, uploads its primary content, and sends the resulting document identifier to the requester.',
      modules: ['files', 'workflows'],
      category: 'operations',
      tags: ['plm', 'documents', 'automation'],
    },
    {
      icon: DocumentIcon,
      title: 'Windchill lifecycle readiness review',
      prompt:
        'Create a workflow that reads a Windchill document and its valid lifecycle transitions, checks required metadata, and produces a readiness report before release.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['plm', 'quality', 'review'],
    },
    {
      icon: DocumentIcon,
      title: 'Windchill structure change summary',
      prompt:
        'Build a workflow that retrieves a Windchill document structure and generates a concise summary of child-document names, versions, states, and missing metadata.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['plm', 'documents', 'analysis'],
    },
    {
      icon: DocumentIcon,
      title: 'Windchill controlled document release',
      prompt:
        'Create a workflow that checks in a Windchill document, validates an allowed lifecycle transition, and moves it to the approved release state.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['plm', 'release', 'governance'],
    },
    {
      icon: DocumentIcon,
      title: 'Windchill attachment package',
      prompt:
        'Build a workflow that uploads a set of inspection files as Windchill document attachments and returns the accepted file names for an audit record.',
      modules: ['files', 'workflows'],
      category: 'operations',
      tags: ['plm', 'files', 'quality'],
    },
    {
      icon: DocumentIcon,
      title: 'Windchill revision preparation',
      prompt:
        'Create a workflow that checks out a Windchill document, updates selected attributes, checks it in with notes, and revises it for the next change cycle.',
      modules: ['workflows'],
      category: 'engineering',
      tags: ['plm', 'versioning', 'automation'],
    },
    {
      icon: DocumentIcon,
      title: 'Windchill document inventory',
      prompt:
        'Build a scheduled workflow that pages through Windchill documents, records their numbers, versions, states, and folder locations in a table, and flags stale checked-out documents.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['plm', 'inventory', 'monitoring'],
    },
  ],
} as const satisfies BlockMeta
