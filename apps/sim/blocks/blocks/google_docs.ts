import { GoogleDocsIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { GoogleDocsResponse } from '@/tools/google_docs/types'

export const GoogleDocsBlock: BlockConfig<GoogleDocsResponse> = {
  type: 'google_docs',
  name: 'Google Docs',
  description: 'Read, write, and create documents',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate Google Docs into the workflow. Can read, write, and create documents.',
  docsLink: 'https://docs.sim.ai/tools/google_docs',
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
      value: () => 'read',
    },
    // Google Docs Credentials
    {
      id: 'credential',
      title: 'Google Account',
      type: 'oauth-input',
      layout: 'full',
      required: true,
      provider: 'google-docs',
      serviceId: 'google-docs',
      requiredScopes: ['https://www.googleapis.com/auth/drive.file'],
      placeholder: 'Select Google account',
    },
    // Document selector (basic mode)
    {
      id: 'documentId',
      title: 'Select Document',
      type: 'file-selector',
      layout: 'full',
      canonicalParamId: 'documentId',
      provider: 'google-drive',
      serviceId: 'google-drive',
      requiredScopes: [],
      mimeType: 'application/vnd.google-apps.document',
      placeholder: 'Select a document',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: ['read', 'write'] },
    },
    // Manual document ID input (advanced mode)
    {
      id: 'manualDocumentId',
      title: 'Document ID',
      type: 'short-input',
      layout: 'full',
      canonicalParamId: 'documentId',
      placeholder: 'Enter document ID',
      dependsOn: ['credential'],
      mode: 'advanced',
      condition: { field: 'operation', value: ['read', 'write'] },
    },
    // Create-specific Fields
    {
      id: 'title',
      title: 'Document Title',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter title for the new document',
      condition: { field: 'operation', value: 'create' },
      required: true,
    },
    // Folder selector (basic mode)
    {
      id: 'folderSelector',
      title: 'Select Parent Folder',
      type: 'file-selector',
      layout: 'full',
      canonicalParamId: 'folderId',
      provider: 'google-drive',
      serviceId: 'google-drive',
      requiredScopes: [],
      mimeType: 'application/vnd.google-apps.folder',
      placeholder: 'Select a parent folder',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: 'create' },
    },
    // Manual folder ID input (advanced mode)
    {
      id: 'folderId',
      title: 'Parent Folder ID',
      type: 'short-input',
      layout: 'full',
      canonicalParamId: 'folderId',
      placeholder: 'Enter parent folder ID (leave empty for root folder)',
      dependsOn: ['credential'],
      mode: 'advanced',
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
      required: true,
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
        const { credential, documentId, manualDocumentId, folderSelector, folderId, ...rest } =
          params

        // Handle both selector and manual inputs
        const effectiveDocumentId = (documentId || manualDocumentId || '').trim()
        const effectiveFolderId = (folderSelector || folderId || '').trim()

        return {
          ...rest,
          documentId: effectiveDocumentId || undefined,
          folderId: effectiveFolderId || undefined,
          credential,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    credential: { type: 'string', description: 'Google Docs access token' },
    documentId: { type: 'string', description: 'Document identifier' },
    manualDocumentId: { type: 'string', description: 'Manual document identifier' },
    title: { type: 'string', description: 'Document title' },
    folderSelector: { type: 'string', description: 'Selected folder' },
    folderId: { type: 'string', description: 'Folder identifier' },
    content: { type: 'string', description: 'Document content' },
  },
  outputs: {
    content: { type: 'string', description: 'Document content' },
    metadata: { type: 'json', description: 'Document metadata' },
    updatedContent: { type: 'boolean', description: 'Content update status' },
  },
}
