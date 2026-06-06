import { GoogleDocsIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { SERVICE_ACCOUNT_SUBBLOCKS } from '@/blocks/utils'
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
  integrationType: IntegrationType.Documents,
  bgColor: '#FFFFFF',
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
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      required: true,
      serviceId: 'google-docs',
      requiredScopes: getScopesForService('google-docs'),
      placeholder: 'Select Google account',
    },
    {
      id: 'manualCredential',
      title: 'Google Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    ...SERVICE_ACCOUNT_SUBBLOCKS,
    // Document selector (basic mode)
    {
      id: 'documentId',
      title: 'Select Document',
      type: 'file-selector',
      canonicalParamId: 'documentId',
      serviceId: 'google-docs',
      selectorKey: 'google.drive',
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
      selectorKey: 'google.drive',
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
    // Markdown formatting toggle for create operation
    {
      id: 'markdown',
      title: 'Interpret content as Markdown',
      type: 'switch',
      condition: { field: 'operation', value: 'create' },
      description:
        'Convert headings, bold/italic, lists, tables, links, code, and blockquotes into formatted Google Docs content. When off, content is inserted as plain text.',
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
        const { oauthCredential, documentId, folderId, ...rest } = params

        const effectiveDocumentId = documentId ? String(documentId).trim() : ''
        const effectiveFolderId = folderId ? String(folderId).trim() : ''

        return {
          ...rest,
          documentId: effectiveDocumentId || undefined,
          folderId: effectiveFolderId || undefined,
          oauthCredential,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'Google Docs access token' },
    documentId: { type: 'string', description: 'Document identifier (canonical param)' },
    title: { type: 'string', description: 'Document title' },
    folderId: { type: 'string', description: 'Parent folder identifier (canonical param)' },
    content: { type: 'string', description: 'Document content' },
    markdown: {
      type: 'boolean',
      description: 'Interpret content as Markdown when creating a document',
    },
  },
  outputs: {
    content: { type: 'string', description: 'Document content' },
    metadata: { type: 'json', description: 'Document metadata' },
    updatedContent: { type: 'boolean', description: 'Content update status' },
  },
}

export const GoogleDocsBlockMeta = {
  tags: ['google-workspace', 'document-processing', 'content-management'],
  templates: [
    {
      icon: GoogleDocsIcon,
      title: 'Google Docs review-cycle automator',
      prompt:
        'Build a workflow that watches Google Docs for a "ready-for-review" status comment, notifies named reviewers over Slack, collects approval reactions, and resolves the comment when complete.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleDocsIcon,
      title: 'Google Docs version digester',
      prompt:
        'Create a scheduled weekly workflow that compares Google Docs revisions for tracked documents, summarizes who changed what, and posts a digest to the doc owner.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleDocsIcon,
      title: 'Google Docs translation copy',
      prompt:
        'Build a workflow that takes a Google Docs document and creates translated copies into target languages with Google Translate, links them in the source, and notifies the localization team.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['content', 'enterprise'],
      alsoIntegrations: ['google_translate'],
    },
    {
      icon: GoogleDocsIcon,
      title: 'Meeting notes to Google Docs',
      prompt:
        'Create a workflow that after a meeting pulls the transcript, summarizes decisions, action items, and owners with an agent, and creates a formatted Google Docs document in the shared team folder with a link posted to Slack.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'meeting', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleDocsIcon,
      title: 'Google Docs proposal generator',
      prompt:
        'Build a workflow that on a closed-won deal reads the account details, creates a Google Docs document from the proposal template, fills in customer name, scope, and pricing, and shares the draft with the account owner for review.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'content', 'automation'],
    },
    {
      icon: GoogleDocsIcon,
      title: 'Weekly report writer',
      prompt:
        'Create a scheduled weekly workflow that reads metrics from my tables, writes a narrative status report with an agent, and appends the new section to a running Google Docs document so leadership has one living record.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['reporting', 'analysis'],
    },
    {
      icon: GoogleDocsIcon,
      title: 'Google Docs knowledge sync',
      prompt:
        'Build a workflow that reads a set of Google Docs in a folder, extracts their content, and upserts it into a knowledge base so the team can ask questions and get answers grounded in the latest docs.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'research', 'sync'],
    },
  ],
} as const satisfies BlockMeta
