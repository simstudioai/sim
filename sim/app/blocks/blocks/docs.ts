import { GoogleDocsIcon } from '@/components/icons'
import {
  GoogleDocsCreateResponse,
  GoogleDocsReadResponse,
  GoogleDocsWriteResponse,
} from '@/tools/docs/types'
import { BlockConfig } from '../types'

type GoogleDocsResponse =
  | GoogleDocsReadResponse
  | GoogleDocsWriteResponse
  | GoogleDocsCreateResponse

export const GoogleDocsBlock: BlockConfig<GoogleDocsResponse> = {
  type: 'google_docs',
  name: 'Google Docs',
  description: 'Read, write, and create documents',
  longDescription:
    'Integrate Google Docs functionality to manage documents. Read content from existing documents, write to documents, and create new documents using OAuth authentication. Supports text content manipulation for document creation and editing.',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: GoogleDocsIcon,
  subBlocks: [
    // Operation selector
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Read Document', id: 'read' },
        { label: 'Write to Document', id: 'write' },
        { label: 'Create Document', id: 'create' },
      ],
    },
    // Google Docs Credentials
    {
      id: 'credential',
      title: 'Google Account',
      type: 'oauth-input',
      layout: 'full',
      provider: 'google-docs',
      serviceId: 'google-docs',
      requiredScopes: ['https://www.googleapis.com/auth/drive.file'],
      placeholder: 'Select Google account',
    },
    // Document Selector for read operation
    {
      id: 'documentId',
      title: 'Select Document',
      type: 'file-selector',
      layout: 'full',
      provider: 'google-drive',
      serviceId: 'google-drive',
      requiredScopes: [],
      mimeType: 'application/vnd.google-apps.document',
      placeholder: 'Select a document',
      condition: { field: 'operation', value: 'read' },
    },
    // Document Selector for write operation
    {
      id: 'documentId',
      title: 'Select Document',
      type: 'file-selector',
      layout: 'full',
      provider: 'google-drive',
      serviceId: 'google-drive',
      requiredScopes: [],
      mimeType: 'application/vnd.google-apps.document',
      placeholder: 'Select a document',
      condition: { field: 'operation', value: 'write' },
    },
    // Manual Document ID for read operation
    {
      id: 'manualDocumentId',
      title: 'Or Enter Document ID Manually',
      type: 'short-input',
      layout: 'full',
      placeholder: 'ID of the document (from URL)',
      condition: {
        field: 'operation',
        value: 'read',
        and: { field: 'documentId', value: '' },
      },
    },
    // Manual Document ID for write operation
    {
      id: 'manualDocumentId',
      title: 'Or Enter Document ID Manually',
      type: 'short-input',
      layout: 'full',
      placeholder: 'ID of the document (from URL)',
      condition: {
        field: 'operation',
        value: 'write',
        and: { field: 'documentId', value: '' },
      },
    },
    // Create-specific Fields
    {
      id: 'title',
      title: 'Document Title',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter title for the new document',
      condition: { field: 'operation', value: 'create' },
    },
    {
      id: 'folderId',
      title: 'Parent Folder ID (Optional)',
      type: 'short-input',
      layout: 'full',
      placeholder: 'ID of the parent folder (leave empty for root folder)',
      condition: { field: 'operation', value: 'create' },
    },
    // Content Field for write operation
    {
      id: 'content',
      title: 'Content',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter document content',
      condition: { field: 'operation', value: 'write' },
    },
    // Content Field for create operation
    {
      id: 'content',
      title: 'Content',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter document content',
      condition: { field: 'operation', value: 'create' },
    },
  ],
  tools: {
    access: ['google_docs_read', 'google_docs_write', 'google_docs_create'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'read':
            return 'google_docs_read'
          case 'write':
            return 'google_docs_write'
          case 'create':
            return 'google_docs_create'
          default:
            throw new Error(`Invalid Google Docs operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { credential, documentId, manualDocumentId, ...rest } = params

        // Use the selected document ID or the manually entered one
        // If documentId is provided, it's from the file selector and contains the file ID
        // If not, fall back to manually entered ID
        const effectiveDocumentId = (documentId || manualDocumentId || '').trim()

        if (params.operation !== 'create' && !effectiveDocumentId) {
          throw new Error(
            'Document ID is required. Please select a document or enter an ID manually.'
          )
        }

        return {
          ...rest,
          documentId: effectiveDocumentId,
          credential,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', required: true },
    credential: { type: 'string', required: true },
    documentId: { type: 'string', required: false },
    manualDocumentId: { type: 'string', required: false },
    // Create operation inputs
    title: { type: 'string', required: false },
    folderId: { type: 'string', required: false },
    // Write/Create operation inputs
    content: { type: 'string', required: false },
  },
  outputs: {
    response: {
      type: {
        content: 'string',
        metadata: 'json',
        updatedContent: 'boolean',
      },
    },
  },
}
