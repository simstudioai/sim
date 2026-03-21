import { BoxCompanyIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'

export const BoxBlock: BlockConfig = {
  type: 'box',
  name: 'Box',
  description: 'Manage files, folders, and e-signatures with Box',
  longDescription:
    'Integrate Box into your workflow to manage files, folders, and e-signatures. Upload and download files, search content, create folders, send documents for e-signature, track signing status, and more.',
  docsLink: 'https://docs.sim.ai/tools/box',
  category: 'tools',
  integrationType: IntegrationType.FileStorage,
  tags: ['cloud', 'content-management', 'e-signatures'],
  bgColor: '#FFFFFF',
  icon: BoxCompanyIcon,
  authMode: AuthMode.OAuth,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Upload File', id: 'upload_file' },
        { label: 'Download File', id: 'download_file' },
        { label: 'Get File Info', id: 'get_file_info' },
        { label: 'List Folder Items', id: 'list_folder_items' },
        { label: 'Create Folder', id: 'create_folder' },
        { label: 'Delete File', id: 'delete_file' },
        { label: 'Delete Folder', id: 'delete_folder' },
        { label: 'Copy File', id: 'copy_file' },
        { label: 'Search', id: 'search' },
        { label: 'Update File', id: 'update_file' },
        { label: 'Create Sign Request', id: 'sign_create_request' },
        { label: 'Get Sign Request', id: 'sign_get_request' },
        { label: 'List Sign Requests', id: 'sign_list_requests' },
        { label: 'Cancel Sign Request', id: 'sign_cancel_request' },
        { label: 'Resend Sign Request', id: 'sign_resend_request' },
      ],
      value: () => 'upload_file',
    },
    {
      id: 'credential',
      title: 'Box Account',
      type: 'oauth-input',
      serviceId: 'box',
      requiredScopes: getScopesForService('box'),
      placeholder: 'Select Box account',
      required: true,
    },

    // Upload File fields
    {
      id: 'uploadFile',
      title: 'File',
      type: 'file-upload',
      canonicalParamId: 'file',
      placeholder: 'Upload file to send to Box',
      mode: 'basic',
      multiple: false,
      required: { field: 'operation', value: 'upload_file' },
      condition: { field: 'operation', value: 'upload_file' },
    },
    {
      id: 'fileRef',
      title: 'File',
      type: 'short-input',
      canonicalParamId: 'file',
      placeholder: 'Reference file from previous blocks',
      mode: 'advanced',
      required: { field: 'operation', value: 'upload_file' },
      condition: { field: 'operation', value: 'upload_file' },
    },
    {
      id: 'parentFolderId',
      title: 'Parent Folder ID',
      type: 'short-input',
      placeholder: 'Folder ID (use "0" for root)',
      required: { field: 'operation', value: ['upload_file', 'create_folder', 'copy_file'] },
      condition: { field: 'operation', value: ['upload_file', 'create_folder', 'copy_file'] },
    },
    {
      id: 'uploadFileName',
      title: 'File Name',
      type: 'short-input',
      placeholder: 'Optional filename override',
      condition: { field: 'operation', value: 'upload_file' },
      mode: 'advanced',
    },

    // File ID field (shared by download, get info, delete, copy, update)
    {
      id: 'fileId',
      title: 'File ID',
      type: 'short-input',
      placeholder: 'Box file ID',
      required: {
        field: 'operation',
        value: ['download_file', 'get_file_info', 'delete_file', 'copy_file', 'update_file'],
      },
      condition: {
        field: 'operation',
        value: ['download_file', 'get_file_info', 'delete_file', 'copy_file', 'update_file'],
      },
    },

    // Folder ID field (shared by list, delete folder)
    {
      id: 'folderId',
      title: 'Folder ID',
      type: 'short-input',
      placeholder: 'Box folder ID (use "0" for root)',
      required: { field: 'operation', value: ['list_folder_items', 'delete_folder'] },
      condition: { field: 'operation', value: ['list_folder_items', 'delete_folder'] },
    },

    // Create Folder fields
    {
      id: 'folderName',
      title: 'Folder Name',
      type: 'short-input',
      placeholder: 'Name for the new folder',
      required: { field: 'operation', value: 'create_folder' },
      condition: { field: 'operation', value: 'create_folder' },
    },

    // Copy File fields
    {
      id: 'copyName',
      title: 'New Name',
      type: 'short-input',
      placeholder: 'Optional name for the copy',
      condition: { field: 'operation', value: 'copy_file' },
    },

    // Search fields
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Search query string',
      required: { field: 'operation', value: 'search' },
      condition: { field: 'operation', value: 'search' },
    },
    {
      id: 'ancestorFolderId',
      title: 'Ancestor Folder ID',
      type: 'short-input',
      placeholder: 'Restrict search to a folder',
      condition: { field: 'operation', value: 'search' },
      mode: 'advanced',
    },
    {
      id: 'fileExtensions',
      title: 'File Extensions',
      type: 'short-input',
      placeholder: 'e.g., pdf,docx,xlsx',
      condition: { field: 'operation', value: 'search' },
      mode: 'advanced',
    },
    {
      id: 'contentType',
      title: 'Content Type',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Files', id: 'file' },
        { label: 'Folders', id: 'folder' },
        { label: 'Web Links', id: 'web_link' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'search' },
      mode: 'advanced',
    },

    // Update File fields
    {
      id: 'newName',
      title: 'New Name',
      type: 'short-input',
      placeholder: 'Rename the file',
      condition: { field: 'operation', value: 'update_file' },
    },
    {
      id: 'description',
      title: 'Description',
      type: 'short-input',
      placeholder: 'File description (max 256 chars)',
      condition: { field: 'operation', value: 'update_file' },
    },
    {
      id: 'moveToFolderId',
      title: 'Move to Folder ID',
      type: 'short-input',
      placeholder: 'Move file to this folder',
      condition: { field: 'operation', value: 'update_file' },
      mode: 'advanced',
    },
    {
      id: 'tags',
      title: 'Tags',
      type: 'short-input',
      placeholder: 'Comma-separated tags',
      condition: { field: 'operation', value: 'update_file' },
      mode: 'advanced',
    },

    // Delete Folder options
    {
      id: 'recursive',
      title: 'Delete Recursively',
      type: 'switch',
      condition: { field: 'operation', value: 'delete_folder' },
    },

    // Shared pagination fields (file operations)
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Max results per page',
      condition: {
        field: 'operation',
        value: ['list_folder_items', 'search', 'sign_list_requests'],
      },
      mode: 'advanced',
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: 'Pagination offset',
      condition: { field: 'operation', value: ['list_folder_items', 'search'] },
      mode: 'advanced',
    },

    // List Folder sort options
    {
      id: 'sort',
      title: 'Sort By',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'ID', id: 'id' },
        { label: 'Name', id: 'name' },
        { label: 'Date', id: 'date' },
        { label: 'Size', id: 'size' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'list_folder_items' },
      mode: 'advanced',
    },
    {
      id: 'direction',
      title: 'Sort Direction',
      type: 'dropdown',
      options: [
        { label: 'Ascending', id: 'ASC' },
        { label: 'Descending', id: 'DESC' },
      ],
      value: () => 'ASC',
      condition: { field: 'operation', value: 'list_folder_items' },
      mode: 'advanced',
    },

    // Sign Request fields
    {
      id: 'sourceFileIds',
      title: 'Source File IDs',
      type: 'short-input',
      placeholder: 'Comma-separated Box file IDs (e.g., 12345,67890)',
      required: { field: 'operation', value: 'sign_create_request' },
      condition: { field: 'operation', value: 'sign_create_request' },
    },
    {
      id: 'signerEmail',
      title: 'Signer Email',
      type: 'short-input',
      placeholder: 'Primary signer email address',
      required: { field: 'operation', value: 'sign_create_request' },
      condition: { field: 'operation', value: 'sign_create_request' },
    },
    {
      id: 'signerRole',
      title: 'Signer Role',
      type: 'dropdown',
      options: [
        { label: 'Signer', id: 'signer' },
        { label: 'Approver', id: 'approver' },
        { label: 'Final Copy Reader', id: 'final_copy_reader' },
      ],
      value: () => 'signer',
      condition: { field: 'operation', value: 'sign_create_request' },
    },
    {
      id: 'emailSubject',
      title: 'Email Subject',
      type: 'short-input',
      placeholder: 'Custom email subject line',
      condition: { field: 'operation', value: 'sign_create_request' },
    },
    {
      id: 'emailMessage',
      title: 'Email Message',
      type: 'long-input',
      placeholder: 'Custom message in the signing email',
      condition: { field: 'operation', value: 'sign_create_request' },
    },
    {
      id: 'signRequestName',
      title: 'Request Name',
      type: 'short-input',
      placeholder: 'Name for this sign request',
      condition: { field: 'operation', value: 'sign_create_request' },
    },
    {
      id: 'additionalSigners',
      title: 'Additional Signers',
      type: 'long-input',
      placeholder: '[{"email":"user@example.com","role":"signer"}]',
      condition: { field: 'operation', value: 'sign_create_request' },
      mode: 'advanced',
    },
    {
      id: 'signParentFolderId',
      title: 'Destination Folder ID',
      type: 'short-input',
      placeholder: 'Box folder ID for signed documents',
      condition: { field: 'operation', value: 'sign_create_request' },
      mode: 'advanced',
    },
    {
      id: 'daysValid',
      title: 'Days Valid',
      type: 'short-input',
      placeholder: 'Number of days before expiry (0-730)',
      condition: { field: 'operation', value: 'sign_create_request' },
      mode: 'advanced',
    },
    {
      id: 'areRemindersEnabled',
      title: 'Enable Reminders',
      type: 'switch',
      condition: { field: 'operation', value: 'sign_create_request' },
      mode: 'advanced',
    },
    {
      id: 'areTextSignaturesEnabled',
      title: 'Allow Text Signatures',
      type: 'switch',
      condition: { field: 'operation', value: 'sign_create_request' },
      mode: 'advanced',
    },
    {
      id: 'signatureColor',
      title: 'Signature Color',
      type: 'dropdown',
      options: [
        { label: 'Blue', id: 'blue' },
        { label: 'Black', id: 'black' },
        { label: 'Red', id: 'red' },
      ],
      value: () => 'blue',
      condition: { field: 'operation', value: 'sign_create_request' },
      mode: 'advanced',
    },
    {
      id: 'redirectUrl',
      title: 'Redirect URL',
      type: 'short-input',
      placeholder: 'URL to redirect after signing',
      condition: { field: 'operation', value: 'sign_create_request' },
      mode: 'advanced',
    },
    {
      id: 'declinedRedirectUrl',
      title: 'Declined Redirect URL',
      type: 'short-input',
      placeholder: 'URL to redirect after declining',
      condition: { field: 'operation', value: 'sign_create_request' },
      mode: 'advanced',
    },
    {
      id: 'isDocumentPreparationNeeded',
      title: 'Document Preparation Needed',
      type: 'switch',
      condition: { field: 'operation', value: 'sign_create_request' },
      mode: 'advanced',
    },
    {
      id: 'externalId',
      title: 'External ID',
      type: 'short-input',
      placeholder: 'External system reference ID',
      condition: { field: 'operation', value: 'sign_create_request' },
      mode: 'advanced',
    },

    // Sign Request ID (shared by get, cancel, resend)
    {
      id: 'signRequestId',
      title: 'Sign Request ID',
      type: 'short-input',
      placeholder: 'Box Sign request ID',
      required: {
        field: 'operation',
        value: ['sign_get_request', 'sign_cancel_request', 'sign_resend_request'],
      },
      condition: {
        field: 'operation',
        value: ['sign_get_request', 'sign_cancel_request', 'sign_resend_request'],
      },
    },

    // Sign list pagination marker
    {
      id: 'marker',
      title: 'Pagination Marker',
      type: 'short-input',
      placeholder: 'Marker from previous response',
      condition: { field: 'operation', value: 'sign_list_requests' },
      mode: 'advanced',
    },
  ],

  tools: {
    access: [
      'box_upload_file',
      'box_download_file',
      'box_get_file_info',
      'box_list_folder_items',
      'box_create_folder',
      'box_delete_file',
      'box_delete_folder',
      'box_copy_file',
      'box_search',
      'box_update_file',
      'box_sign_create_request',
      'box_sign_get_request',
      'box_sign_list_requests',
      'box_sign_cancel_request',
      'box_sign_resend_request',
    ],
    config: {
      tool: (params) => {
        const op = params.operation as string
        if (op.startsWith('sign_')) {
          return `box_${op}`
        }
        return `box_${op}`
      },
      params: (params) => {
        const normalizedFile = normalizeFileInput(params.file, { single: true })
        if (normalizedFile) {
          params.file = normalizedFile
        }
        const { credential, operation, ...rest } = params

        const baseParams: Record<string, unknown> = {
          accessToken: credential,
        }

        switch (operation) {
          case 'upload_file':
            baseParams.parentFolderId = rest.parentFolderId
            baseParams.file = rest.file
            if (rest.uploadFileName) baseParams.fileName = rest.uploadFileName
            break
          case 'download_file':
          case 'get_file_info':
          case 'delete_file':
            baseParams.fileId = rest.fileId
            break
          case 'list_folder_items':
            baseParams.folderId = rest.folderId
            if (rest.limit) baseParams.limit = Number(rest.limit)
            if (rest.offset) baseParams.offset = Number(rest.offset)
            if (rest.sort) baseParams.sort = rest.sort
            if (rest.direction) baseParams.direction = rest.direction
            break
          case 'create_folder':
            baseParams.name = rest.folderName
            baseParams.parentFolderId = rest.parentFolderId
            break
          case 'delete_folder':
            baseParams.folderId = rest.folderId
            if (rest.recursive !== undefined) baseParams.recursive = rest.recursive
            break
          case 'copy_file':
            baseParams.fileId = rest.fileId
            baseParams.parentFolderId = rest.parentFolderId
            if (rest.copyName) baseParams.name = rest.copyName
            break
          case 'search':
            baseParams.query = rest.query
            if (rest.limit) baseParams.limit = Number(rest.limit)
            if (rest.offset) baseParams.offset = Number(rest.offset)
            if (rest.ancestorFolderId) baseParams.ancestorFolderId = rest.ancestorFolderId
            if (rest.fileExtensions) baseParams.fileExtensions = rest.fileExtensions
            if (rest.contentType) baseParams.type = rest.contentType
            break
          case 'update_file':
            baseParams.fileId = rest.fileId
            if (rest.newName) baseParams.name = rest.newName
            if (rest.description !== undefined) baseParams.description = rest.description
            if (rest.moveToFolderId) baseParams.parentFolderId = rest.moveToFolderId
            if (rest.tags) baseParams.tags = rest.tags
            break
          case 'sign_create_request':
            baseParams.sourceFileIds = rest.sourceFileIds
            baseParams.signerEmail = rest.signerEmail
            if (rest.signerRole) baseParams.signerRole = rest.signerRole
            if (rest.additionalSigners) baseParams.additionalSigners = rest.additionalSigners
            if (rest.signParentFolderId) baseParams.parentFolderId = rest.signParentFolderId
            if (rest.emailSubject) baseParams.emailSubject = rest.emailSubject
            if (rest.emailMessage) baseParams.emailMessage = rest.emailMessage
            if (rest.signRequestName) baseParams.name = rest.signRequestName
            if (rest.daysValid) baseParams.daysValid = Number(rest.daysValid)
            if (rest.areRemindersEnabled !== undefined)
              baseParams.areRemindersEnabled = rest.areRemindersEnabled
            if (rest.areTextSignaturesEnabled !== undefined)
              baseParams.areTextSignaturesEnabled = rest.areTextSignaturesEnabled
            if (rest.signatureColor) baseParams.signatureColor = rest.signatureColor
            if (rest.redirectUrl) baseParams.redirectUrl = rest.redirectUrl
            if (rest.declinedRedirectUrl) baseParams.declinedRedirectUrl = rest.declinedRedirectUrl
            if (rest.isDocumentPreparationNeeded !== undefined)
              baseParams.isDocumentPreparationNeeded = rest.isDocumentPreparationNeeded
            if (rest.externalId) baseParams.externalId = rest.externalId
            break
          case 'sign_get_request':
          case 'sign_cancel_request':
          case 'sign_resend_request':
            baseParams.signRequestId = rest.signRequestId
            break
          case 'sign_list_requests':
            if (rest.limit) baseParams.limit = Number(rest.limit)
            if (rest.marker) baseParams.marker = rest.marker
            break
        }

        return baseParams
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    credential: { type: 'string', description: 'Box OAuth credential' },
    file: { type: 'json', description: 'File to upload (canonical param)' },
    fileId: { type: 'string', description: 'Box file ID' },
    folderId: { type: 'string', description: 'Box folder ID' },
    parentFolderId: { type: 'string', description: 'Parent folder ID' },
    query: { type: 'string', description: 'Search query' },
    sourceFileIds: { type: 'string', description: 'Comma-separated Box file IDs' },
    signerEmail: { type: 'string', description: 'Primary signer email address' },
    signRequestId: { type: 'string', description: 'Sign request ID' },
  },

  outputs: {
    id: 'string',
    name: 'string',
    description: 'string',
    size: 'number',
    sha1: 'string',
    createdAt: 'string',
    modifiedAt: 'string',
    createdBy: 'json',
    modifiedBy: 'json',
    ownedBy: 'json',
    parentId: 'string',
    parentName: 'string',
    sharedLink: 'json',
    tags: 'json',
    commentCount: 'number',
    file: 'file',
    content: 'string',
    entries: 'json',
    totalCount: 'number',
    offset: 'number',
    limit: 'number',
    results: 'json',
    deleted: 'boolean',
    message: 'string',
    status: 'string',
    shortId: 'string',
    signers: 'json',
    sourceFiles: 'json',
    emailSubject: 'string',
    emailMessage: 'string',
    daysValid: 'number',
    autoExpireAt: 'string',
    prepareUrl: 'string',
    senderEmail: 'string',
    signRequests: 'json',
    count: 'number',
    nextMarker: 'string',
  },
}
