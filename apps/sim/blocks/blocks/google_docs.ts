import { GoogleDocsIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { SERVICE_ACCOUNT_SUBBLOCKS } from '@/blocks/utils'
import type { GoogleDocsResponse } from '@/tools/google_docs/types'

export const GoogleDocsBlock: BlockConfig<GoogleDocsResponse> = {
  type: 'google_docs',
  name: 'Google Docs',
  description: 'Read, write, create, and edit documents',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate Google Docs into the workflow. Read, write, and create documents, insert text, tables, images, and page breaks, find and replace text, and apply text styling.',
  docsLink: 'https://docs.sim.ai/integrations/google_docs',
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
        { label: 'Insert Text', id: 'insert_text' },
        { label: 'Find & Replace Text', id: 'replace_text' },
        { label: 'Insert Table', id: 'insert_table' },
        { label: 'Insert Image', id: 'insert_image' },
        { label: 'Insert Page Break', id: 'insert_page_break' },
        { label: 'Apply Text Style', id: 'update_text_style' },
        { label: 'Apply Paragraph Style', id: 'update_paragraph_style' },
        { label: 'Create Bullets', id: 'create_paragraph_bullets' },
        { label: 'Delete Bullets', id: 'delete_paragraph_bullets' },
        { label: 'Delete Content Range', id: 'delete_content_range' },
        { label: 'Create Named Range', id: 'create_named_range' },
        { label: 'Delete Named Range', id: 'delete_named_range' },
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
      condition: {
        field: 'operation',
        value: [
          'read',
          'write',
          'insert_text',
          'replace_text',
          'insert_table',
          'insert_image',
          'insert_page_break',
          'update_text_style',
          'update_paragraph_style',
          'create_paragraph_bullets',
          'delete_paragraph_bullets',
          'delete_content_range',
          'create_named_range',
          'delete_named_range',
        ],
      },
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
      condition: {
        field: 'operation',
        value: [
          'read',
          'write',
          'insert_text',
          'replace_text',
          'insert_table',
          'insert_image',
          'insert_page_break',
          'update_text_style',
          'update_paragraph_style',
          'create_paragraph_bullets',
          'delete_paragraph_bullets',
          'delete_content_range',
          'create_named_range',
          'delete_named_range',
        ],
      },
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
    // Insert Text fields
    {
      id: 'text',
      title: 'Text',
      type: 'long-input',
      placeholder: 'Enter text to insert',
      condition: { field: 'operation', value: 'insert_text' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate text to insert into a Google Doc based on the user's request.
The text should be well-structured and appropriate for the document.

Return ONLY the text to insert - no explanations, no extra text.`,
        placeholder: 'Describe the text you want to insert...',
      },
    },
    // Find & Replace fields
    {
      id: 'searchText',
      title: 'Find',
      type: 'short-input',
      placeholder: 'Text to find',
      condition: { field: 'operation', value: 'replace_text' },
      required: true,
    },
    {
      id: 'replaceText',
      title: 'Replace With',
      type: 'short-input',
      placeholder: 'Replacement text (leave empty to delete matches)',
      condition: { field: 'operation', value: 'replace_text' },
    },
    {
      id: 'matchCase',
      title: 'Match Case',
      type: 'switch',
      condition: { field: 'operation', value: 'replace_text' },
      description: 'When on, only case-sensitive matches are replaced.',
    },
    // Insert Table fields
    {
      id: 'rows',
      title: 'Rows',
      type: 'short-input',
      placeholder: 'e.g., 3',
      condition: { field: 'operation', value: 'insert_table' },
      required: true,
    },
    {
      id: 'columns',
      title: 'Columns',
      type: 'short-input',
      placeholder: 'e.g., 2',
      condition: { field: 'operation', value: 'insert_table' },
      required: true,
    },
    // Insert Image fields
    {
      id: 'imageUrl',
      title: 'Image URL',
      type: 'short-input',
      placeholder: 'Public URL of the image to insert',
      condition: { field: 'operation', value: 'insert_image' },
      required: true,
    },
    {
      id: 'width',
      title: 'Width (PT)',
      type: 'short-input',
      placeholder: 'Optional width in points',
      condition: { field: 'operation', value: 'insert_image' },
      mode: 'advanced',
    },
    {
      id: 'height',
      title: 'Height (PT)',
      type: 'short-input',
      placeholder: 'Optional height in points',
      condition: { field: 'operation', value: 'insert_image' },
      mode: 'advanced',
    },
    // Range fields shared by style/bullet/range/named-range operations
    {
      id: 'startIndex',
      title: 'Start Index',
      type: 'short-input',
      placeholder: 'Start character index (inclusive)',
      condition: {
        field: 'operation',
        value: [
          'update_text_style',
          'update_paragraph_style',
          'create_paragraph_bullets',
          'delete_paragraph_bullets',
          'delete_content_range',
          'create_named_range',
        ],
      },
      required: true,
    },
    {
      id: 'endIndex',
      title: 'End Index',
      type: 'short-input',
      placeholder: 'End character index (exclusive)',
      condition: {
        field: 'operation',
        value: [
          'update_text_style',
          'update_paragraph_style',
          'create_paragraph_bullets',
          'delete_paragraph_bullets',
          'delete_content_range',
          'create_named_range',
        ],
      },
      required: true,
    },
    {
      id: 'bold',
      title: 'Bold',
      type: 'switch',
      condition: { field: 'operation', value: 'update_text_style' },
    },
    {
      id: 'italic',
      title: 'Italic',
      type: 'switch',
      condition: { field: 'operation', value: 'update_text_style' },
    },
    {
      id: 'underline',
      title: 'Underline',
      type: 'switch',
      condition: { field: 'operation', value: 'update_text_style' },
    },
    {
      id: 'fontSize',
      title: 'Font Size (PT)',
      type: 'short-input',
      placeholder: 'Optional font size in points',
      condition: { field: 'operation', value: 'update_text_style' },
      mode: 'advanced',
    },
    // Apply Paragraph Style fields
    {
      id: 'namedStyleType',
      title: 'Paragraph Style',
      type: 'dropdown',
      options: [
        { label: 'Default (unchanged)', id: '' },
        { label: 'Normal Text', id: 'NORMAL_TEXT' },
        { label: 'Title', id: 'TITLE' },
        { label: 'Subtitle', id: 'SUBTITLE' },
        { label: 'Heading 1', id: 'HEADING_1' },
        { label: 'Heading 2', id: 'HEADING_2' },
        { label: 'Heading 3', id: 'HEADING_3' },
        { label: 'Heading 4', id: 'HEADING_4' },
        { label: 'Heading 5', id: 'HEADING_5' },
        { label: 'Heading 6', id: 'HEADING_6' },
      ],
      condition: { field: 'operation', value: 'update_paragraph_style' },
    },
    {
      id: 'alignment',
      title: 'Alignment',
      type: 'dropdown',
      options: [
        { label: 'Default (unchanged)', id: '' },
        { label: 'Left', id: 'LEFT' },
        { label: 'Center', id: 'CENTER' },
        { label: 'Right', id: 'RIGHT' },
        { label: 'Justify', id: 'JUSTIFY' },
      ],
      condition: { field: 'operation', value: 'update_paragraph_style' },
    },
    // Create Bullets fields
    {
      id: 'bulletPreset',
      title: 'Bullet Style',
      type: 'dropdown',
      options: [
        { label: 'Disc / Circle / Square', id: 'BULLET_DISC_CIRCLE_SQUARE' },
        { label: 'Checkbox', id: 'BULLET_CHECKBOX' },
        { label: 'Arrow / Diamond / Disc', id: 'BULLET_ARROW_DIAMOND_DISC' },
        { label: 'Star / Circle / Square', id: 'BULLET_STAR_CIRCLE_SQUARE' },
        { label: 'Numbered: Decimal / Alpha / Roman', id: 'NUMBERED_DECIMAL_ALPHA_ROMAN' },
        { label: 'Numbered: Decimal Nested', id: 'NUMBERED_DECIMAL_NESTED' },
      ],
      condition: { field: 'operation', value: 'create_paragraph_bullets' },
    },
    // Create Named Range fields
    {
      id: 'name',
      title: 'Range Name',
      type: 'short-input',
      placeholder: 'Name for the range (1-256 characters)',
      condition: { field: 'operation', value: 'create_named_range' },
      required: true,
    },
    // Delete Named Range fields
    {
      id: 'namedRangeId',
      title: 'Named Range ID',
      type: 'short-input',
      placeholder: 'ID of the named range to delete',
      condition: { field: 'operation', value: 'delete_named_range' },
    },
    {
      id: 'namedRangeName',
      title: 'Named Range Name',
      type: 'short-input',
      placeholder: 'Name of the named range(s) to delete',
      condition: { field: 'operation', value: 'delete_named_range' },
    },
    // Shared insertion index (advanced) for the insert operations
    {
      id: 'index',
      title: 'Insertion Index',
      type: 'short-input',
      placeholder: 'Character index (leave empty to append at end)',
      condition: {
        field: 'operation',
        value: ['insert_text', 'insert_table', 'insert_image', 'insert_page_break'],
      },
      mode: 'advanced',
    },
  ],
  tools: {
    access: [
      'google_docs_read',
      'google_docs_write',
      'google_docs_create',
      'google_docs_insert_text',
      'google_docs_replace_text',
      'google_docs_insert_table',
      'google_docs_insert_image',
      'google_docs_insert_page_break',
      'google_docs_update_text_style',
      'google_docs_update_paragraph_style',
      'google_docs_create_paragraph_bullets',
      'google_docs_delete_paragraph_bullets',
      'google_docs_delete_content_range',
      'google_docs_create_named_range',
      'google_docs_delete_named_range',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'read':
            return 'google_docs_read'
          case 'write':
            return 'google_docs_write'
          case 'create':
            return 'google_docs_create'
          case 'insert_text':
            return 'google_docs_insert_text'
          case 'replace_text':
            return 'google_docs_replace_text'
          case 'insert_table':
            return 'google_docs_insert_table'
          case 'insert_image':
            return 'google_docs_insert_image'
          case 'insert_page_break':
            return 'google_docs_insert_page_break'
          case 'update_text_style':
            return 'google_docs_update_text_style'
          case 'update_paragraph_style':
            return 'google_docs_update_paragraph_style'
          case 'create_paragraph_bullets':
            return 'google_docs_create_paragraph_bullets'
          case 'delete_paragraph_bullets':
            return 'google_docs_delete_paragraph_bullets'
          case 'delete_content_range':
            return 'google_docs_delete_content_range'
          case 'create_named_range':
            return 'google_docs_create_named_range'
          case 'delete_named_range':
            return 'google_docs_delete_named_range'
          default:
            throw new Error(`Invalid Google Docs operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { oauthCredential, documentId, folderId, ...rest } = params

        const effectiveDocumentId = documentId ? String(documentId).trim() : ''
        const effectiveFolderId = folderId ? String(folderId).trim() : ''

        const toNumber = (value: unknown): number | undefined => {
          if (value === undefined || value === null || value === '') return undefined
          const parsed = Number(value)
          return Number.isFinite(parsed) ? parsed : undefined
        }

        const numericFields = [
          'index',
          'rows',
          'columns',
          'width',
          'height',
          'startIndex',
          'endIndex',
          'fontSize',
        ] as const

        const coerced: Record<string, unknown> = {}
        for (const field of numericFields) {
          const value = (rest as Record<string, unknown>)[field]
          const num = toNumber(value)
          if (num !== undefined) coerced[field] = num
          else delete (rest as Record<string, unknown>)[field]
        }

        return {
          ...rest,
          ...coerced,
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
    text: { type: 'string', description: 'Text to insert' },
    index: { type: 'number', description: 'Insertion character index' },
    searchText: { type: 'string', description: 'Text to find' },
    replaceText: { type: 'string', description: 'Replacement text' },
    matchCase: { type: 'boolean', description: 'Case-sensitive find & replace' },
    rows: { type: 'number', description: 'Number of table rows' },
    columns: { type: 'number', description: 'Number of table columns' },
    imageUrl: { type: 'string', description: 'Public URL of image to insert' },
    width: { type: 'number', description: 'Image width in points' },
    height: { type: 'number', description: 'Image height in points' },
    startIndex: { type: 'number', description: 'Start character index of style range' },
    endIndex: { type: 'number', description: 'End character index of style range' },
    bold: { type: 'boolean', description: 'Apply bold styling' },
    italic: { type: 'boolean', description: 'Apply italic styling' },
    underline: { type: 'boolean', description: 'Apply underline styling' },
    fontSize: { type: 'number', description: 'Font size in points' },
    namedStyleType: { type: 'string', description: 'Named paragraph style to apply' },
    alignment: { type: 'string', description: 'Paragraph alignment to apply' },
    bulletPreset: { type: 'string', description: 'Bullet glyph preset to apply' },
    name: { type: 'string', description: 'Name for a created named range' },
    namedRangeId: { type: 'string', description: 'ID of a named range to delete' },
    namedRangeName: { type: 'string', description: 'Name of named range(s) to delete' },
  },
  outputs: {
    content: { type: 'string', description: 'Document content' },
    metadata: { type: 'json', description: 'Document metadata' },
    updatedContent: { type: 'boolean', description: 'Content update status' },
    occurrencesChanged: {
      type: 'number',
      description: 'Number of occurrences replaced during find & replace',
    },
    objectId: { type: 'string', description: 'ID of an inserted inline image object' },
    namedRangeId: { type: 'string', description: 'ID of a created named range' },
  },
}

export const GoogleDocsBlockMeta = {
  tags: ['google-workspace', 'document-processing', 'content-management'],
  url: 'https://www.google.com/docs/about',
  templates: [
    {
      icon: GoogleDocsIcon,
      title: 'Google Docs review request',
      prompt:
        'Build a workflow that reads a Google Doc when its title is marked ready for review, summarizes the key points with an agent, and posts a review request with the doc link to the named reviewers in Slack.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleDocsIcon,
      title: 'Google Docs change digester',
      prompt:
        'Create a scheduled weekly workflow that reads each tracked Google Doc, compares its content against the snapshot stored in a table, summarizes what changed with an agent, and posts a digest to the team in Slack.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
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
      title: 'Google Docs weekly report',
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
  skills: [
    {
      name: 'create-document-from-content',
      description: 'Create a new Google Doc with a title and formatted content in a chosen folder.',
      content:
        '# Create a Document from Content\n\nGenerate a new Google Doc from supplied or drafted content.\n\n## Steps\n1. Determine the document title and the body content from the request.\n2. If the content uses headings, bold, lists, tables, or links, enable the Markdown option so it renders as formatted Doc content; otherwise leave it off for plain text.\n3. Optionally set the parent folder ID to file the doc in the right place.\n4. Run the Create Document operation with the title, content, and folder.\n\n## Output\nConfirm creation and return the document ID and link. If a folder was specified, confirm it was placed there.',
    },
    {
      name: 'summarize-document',
      description:
        'Read a Google Doc and produce a concise summary with key points and action items.',
      content:
        '# Summarize a Document\n\nRead a Doc and distill it.\n\n## Steps\n1. Obtain the document ID (select the doc or pass its ID).\n2. Run the Read Document operation to pull the full text.\n3. Identify the main thesis, key points, decisions, and any action items or owners.\n4. Keep the summary faithful to the source; do not invent details not present.\n\n## Output\nA short summary: a one-line gist, 3-6 bullet key points, and an Action Items section (owner + task) if any exist. Reference the doc link.',
    },
    {
      name: 'append-to-document',
      description:
        'Write additional content into an existing Google Doc, such as a running log or report section.',
      content:
        '# Append to a Document\n\nAdd a new section to an existing Doc.\n\n## Steps\n1. Obtain the target document ID.\n2. Draft the content to add, clearly delimited (e.g., a dated heading for a running log).\n3. Run the Write to Document operation with the document ID and the new content.\n4. For recurring updates, prefix each entry with a date or section header so the doc stays organized.\n\n## Output\nConfirm the content was written and return the document link. Summarize in one line what was appended.',
    },
  ],
} as const satisfies BlockMeta
