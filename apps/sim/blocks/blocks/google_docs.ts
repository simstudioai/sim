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
      required: true,
      serviceId: 'google-docs',
      requiredScopes: [
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/drive',
      ],
      placeholder: 'Select Google account',
    },
    // Document selector (basic mode)
    {
      id: 'documentId',
      title: 'Select Document',
      type: 'file-selector',
      canonicalParamId: 'documentId',
      serviceId: 'google-docs',
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
      placeholder: 'Enter title for the new document',
      condition: { field: 'operation', value: 'create' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a clear, descriptive document title based on the user's request.
The title should be concise but informative about the document's purpose.

Return ONLY the document title - no explanations, no extra text.`,
        placeholder: 'Describe the document...',
      },
    },
    // Folder selector (basic mode)
    {
      id: 'folderSelector',
      title: 'Select Parent Folder',
      type: 'file-selector',
      canonicalParamId: 'folderId',
      serviceId: 'google-docs',
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
      placeholder: 'Enter document content',
      condition: { field: 'operation', value: 'write' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate document content based on the user's request.
The content should be well-structured and appropriate for a Google Doc.

Return ONLY the document content - no explanations, no extra text.`,
        placeholder: 'Describe the document content you want to write...',
      },
    },
    // Content Field for create operation
    {
      id: 'content',
      title: 'Content',
      type: 'long-input',
      placeholder: 'Enter document content',
      condition: { field: 'operation', value: 'create' },
      wandConfig: {
        enabled: true,
        prompt: `Generate initial document content based on the user's request.
The content should be well-structured and appropriate for a new Google Doc.

Return ONLY the document content - no explanations, no extra text.`,
        placeholder: 'Describe the document content you want to create...',
      },
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
        const { credential, documentId, folderId, ...rest } = params

        const effectiveDocumentId = documentId ? String(documentId).trim() : ''
        const effectiveFolderId = folderId ? String(folderId).trim() : ''

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
    documentId: { type: 'string', description: 'Document identifier (canonical param)' },
    title: { type: 'string', description: 'Document title' },
    folderId: { type: 'string', description: 'Parent folder identifier (canonical param)' },
    content: { type: 'string', description: 'Document content' },
  },
  outputs: {
    content: { type: 'string', description: 'Document content' },
    metadata: { type: 'json', description: 'Document metadata' },
    updatedContent: { type: 'boolean', description: 'Content update status' },
  },
}
