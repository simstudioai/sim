import { MicrosoftWordIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { MicrosoftWordResponse } from '@/tools/microsoft_word/types'

const DOCUMENT_FIELD = ['documentSelector', 'manualDocumentId'] as const

const CREATE_FOLDER_FIELD = ['createFolderSelector', 'createManualFolderId'] as const
const LIST_FOLDER_FIELD = ['listFolderSelector', 'listManualFolderId'] as const

const TEMPLATE_FIELD = ['templateSelector', 'manualTemplateId'] as const

const DOCUMENT_OPERATIONS = ['read', 'update', 'append', 'replace_text', 'export_pdf'] as const

/** Normalizes an empty/whitespace input value to `undefined`, otherwise a trimmed string. */
function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  const trimmed = String(value).trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/** Coerces a numeric input value to a number, or `undefined` when unset or invalid. */
function optionalNumber(value: unknown): number | undefined {
  const str = optionalString(value)
  if (str === undefined) return undefined
  const num = Number(str)
  return Number.isNaN(num) ? undefined : num
}

/** Coerces a 'true'/'false' dropdown value to boolean, or `undefined` when unset. */
function optionalBoolean(value: unknown): boolean | undefined {
  const str = optionalString(value)
  if (str === undefined) return undefined
  if (str === 'true') return true
  if (str === 'false') return false
  return undefined
}

/**
 * Passes a JSON-object input through untouched when it is already an object and
 * trims it when it arrived as text. Stringifying an object here would send
 * `"[object Object]"`, so the object case must not go through
 * {@link optionalString}.
 */
function optionalJson(value: unknown): unknown {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'object') return value
  return optionalString(value)
}

/**
 * Returns a value verbatim as a string. Find-and-replace operands are literal —
 * trimming them would make "collapse double spaces" or "replace X with a single
 * space" impossible to express.
 */
function rawString(value: unknown): string {
  return value === undefined || value === null ? '' : String(value)
}

/** Like {@link rawString}, but rejects an empty (not merely blank) required operand. */
function requireRawString(value: unknown, label: string): string {
  const raw = rawString(value)
  if (raw.length === 0) {
    throw new Error(`${label} is required.`)
  }
  return raw
}

/** Returns a trimmed required value, throwing with a field-specific message when empty. */
function requireString(value: unknown, label: string): string {
  const trimmed = optionalString(value)
  if (!trimmed) {
    throw new Error(`${label} is required.`)
  }
  return trimmed
}

export const MicrosoftWordBlock: BlockConfig<MicrosoftWordResponse> = {
  type: 'microsoft_word',
  name: 'Microsoft Word',
  description: 'Create, fill, read, edit, and export Word documents',
  longDescription:
    'Integrate Microsoft Word into the workflow. Create .docx documents from text, fill a formatted template by substituting its placeholders, read a document back as text, replace or append content, find and replace text across the body plus headers and footers, list and search documents in OneDrive or SharePoint, and export a document as PDF.',
  docsLink: 'https://docs.sim.ai/integrations/microsoft_word',
  category: 'tools',
  integrationType: IntegrationType.Documents,
  bgColor: '#FFFFFF',
  icon: MicrosoftWordIcon,
  authMode: AuthMode.OAuth,
  canvasPresentation: {
    defaultTitle: 'Microsoft Word',
    sentences: {
      byOperation: {
        create: [
          { text: 'Create document', field: 'name', core: true },
          { text: 'in', field: CREATE_FOLDER_FIELD },
        ],
        create_from_template: [
          { text: 'Fill template', field: TEMPLATE_FIELD, core: true },
          { text: 'into', field: 'name' },
        ],
        read: [{ text: 'Read', field: DOCUMENT_FIELD, core: true }],
        update: [{ text: 'Replace the contents of', field: DOCUMENT_FIELD, core: true }],
        append: [{ text: 'Append to', field: DOCUMENT_FIELD, core: true }],
        replace_text: [
          { text: 'Replace', field: 'findText', core: true },
          { text: 'in', field: DOCUMENT_FIELD },
        ],
        list: [
          'List Word documents',
          { text: 'in', field: LIST_FOLDER_FIELD },
          { text: ', matching', field: 'query' },
        ],
        export_pdf: [
          { text: 'Export', field: DOCUMENT_FIELD, core: true },
          { text: 'as PDF named', field: 'fileName' },
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
        { label: 'Read Document', id: 'read' },
        { label: 'Create Document', id: 'create' },
        { label: 'Create from Template', id: 'create_from_template' },
        { label: 'Replace Content', id: 'update' },
        { label: 'Append Content', id: 'append' },
        { label: 'Find and Replace Text', id: 'replace_text' },
        { label: 'List Documents', id: 'list' },
        { label: 'Export as PDF', id: 'export_pdf' },
      ],
      value: () => 'read',
    },
    {
      id: 'credential',
      title: 'Microsoft Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      serviceId: 'microsoft-word',
      requiredScopes: getScopesForService('microsoft-word'),
      placeholder: 'Select Microsoft account',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'Microsoft Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    {
      id: 'documentSelector',
      title: 'Select Document',
      type: 'file-selector',
      canonicalParamId: 'documentId',
      serviceId: 'microsoft-word',
      selectorKey: 'microsoft.word',
      requiredScopes: [],
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      placeholder: 'Select a Word document',
      dependsOn: ['credential', 'driveId'],
      mode: 'basic',
      condition: { field: 'operation', value: [...DOCUMENT_OPERATIONS] },
      required: { field: 'operation', value: [...DOCUMENT_OPERATIONS] },
    },
    {
      id: 'manualDocumentId',
      title: 'Document ID',
      type: 'short-input',
      canonicalParamId: 'documentId',
      mode: 'advanced',
      placeholder: 'Enter document ID',
      dependsOn: ['credential'],
      condition: { field: 'operation', value: [...DOCUMENT_OPERATIONS] },
      required: { field: 'operation', value: [...DOCUMENT_OPERATIONS] },
    },
    {
      id: 'templateSelector',
      title: 'Select Template',
      type: 'file-selector',
      canonicalParamId: 'templateDocumentId',
      serviceId: 'microsoft-word',
      selectorKey: 'microsoft.word',
      requiredScopes: [],
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      placeholder: 'Select a Word template',
      dependsOn: ['credential', 'driveId'],
      mode: 'basic',
      condition: { field: 'operation', value: 'create_from_template' },
      required: { field: 'operation', value: 'create_from_template' },
    },
    {
      id: 'manualTemplateId',
      title: 'Template Document ID',
      type: 'short-input',
      canonicalParamId: 'templateDocumentId',
      mode: 'advanced',
      placeholder: 'Enter template document ID',
      dependsOn: ['credential'],
      condition: { field: 'operation', value: 'create_from_template' },
      required: { field: 'operation', value: 'create_from_template' },
    },
    {
      id: 'name',
      title: 'Document Name',
      type: 'short-input',
      placeholder: 'Q3 Report',
      condition: { field: 'operation', value: ['create', 'create_from_template'] },
      required: { field: 'operation', value: ['create', 'create_from_template'] },
    },
    {
      id: 'replacements',
      title: 'Placeholder Values',
      type: 'long-input',
      placeholder: '{"{{customer_name}}": "Acme Corp", "{{date}}": "2026-01-31"}',
      condition: { field: 'operation', value: 'create_from_template' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON object mapping each placeholder in a Word template to the value that should replace it, e.g. {"{{customer_name}}": "Acme Corp"}. Return ONLY the JSON object - no explanations, no extra text.',
        generationType: 'json-object',
      },
    },
    {
      id: 'content',
      title: 'Content',
      type: 'long-input',
      placeholder:
        'Supports # headings, - bullets, and **bold** / *italic*. Every other line becomes a paragraph.',
      condition: { field: 'operation', value: ['create', 'update'] },
      required: { field: 'operation', value: 'update' },
      wandConfig: {
        enabled: true,
        prompt:
          'Write the body of a Word document. Use # / ## / ### for headings, - for bullets, and **bold** or *italic* for emphasis. Return only the document text.',
      },
    },
    {
      id: 'appendContent',
      title: 'Content to Append',
      type: 'long-input',
      placeholder: 'Each non-empty line becomes a new paragraph at the end of the document',
      condition: { field: 'operation', value: 'append' },
      required: { field: 'operation', value: 'append' },
    },
    {
      id: 'createFolderSelector',
      title: 'Destination Folder',
      type: 'file-selector',
      canonicalParamId: 'createFolderId',
      serviceId: 'microsoft-word',
      selectorKey: 'onedrive.folders',
      requiredScopes: [],
      mimeType: 'application/vnd.microsoft.graph.folder',
      placeholder: 'Leave empty to use the drive root',
      dependsOn: ['credential', 'driveId'],
      mode: 'basic',
      condition: { field: 'operation', value: ['create', 'create_from_template'] },
    },
    {
      id: 'createManualFolderId',
      title: 'Destination Folder ID',
      type: 'short-input',
      canonicalParamId: 'createFolderId',
      placeholder: 'Leave empty to create in the drive root',
      dependsOn: ['credential'],
      mode: 'advanced',
      condition: { field: 'operation', value: ['create', 'create_from_template'] },
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Leave empty to list the documents in the folder',
      condition: { field: 'operation', value: 'list' },
    },
    {
      id: 'listFolderSelector',
      title: 'Folder',
      type: 'file-selector',
      canonicalParamId: 'listFolderId',
      serviceId: 'microsoft-word',
      selectorKey: 'onedrive.folders',
      requiredScopes: [],
      mimeType: 'application/vnd.microsoft.graph.folder',
      placeholder: 'Leave empty to use the drive root',
      dependsOn: ['credential', 'driveId'],
      mode: 'basic',
      condition: { field: 'operation', value: 'list' },
    },
    {
      id: 'listManualFolderId',
      title: 'Folder ID',
      type: 'short-input',
      canonicalParamId: 'listFolderId',
      placeholder: 'Leave empty to use the drive root',
      dependsOn: ['credential'],
      mode: 'advanced',
      condition: { field: 'operation', value: 'list' },
    },
    {
      id: 'pageSize',
      title: 'Max Results',
      type: 'short-input',
      placeholder: '50',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list' },
    },
    {
      id: 'pageToken',
      title: 'Page Token',
      type: 'short-input',
      placeholder: "nextPageToken from a previous run's output",
      mode: 'advanced',
      condition: { field: 'operation', value: 'list' },
    },
    {
      id: 'findText',
      title: 'Find',
      type: 'short-input',
      placeholder: 'Text to find, e.g. {{customer_name}}',
      condition: { field: 'operation', value: 'replace_text' },
      required: { field: 'operation', value: 'replace_text' },
    },
    {
      id: 'replaceText',
      title: 'Replace With',
      type: 'short-input',
      placeholder: 'Leave empty to delete the matched text',
      condition: { field: 'operation', value: 'replace_text' },
    },
    {
      id: 'matchCase',
      title: 'Match Case',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      mode: 'advanced',
      condition: { field: 'operation', value: ['replace_text', 'create_from_template'] },
    },
    {
      id: 'fileName',
      title: 'PDF File Name',
      type: 'short-input',
      placeholder: 'Defaults to the document name with a .pdf extension',
      mode: 'advanced',
      condition: { field: 'operation', value: 'export_pdf' },
    },
    {
      id: 'driveId',
      title: 'Drive ID (SharePoint)',
      type: 'short-input',
      placeholder: 'Leave empty for OneDrive, or enter a drive ID for SharePoint',
      mode: 'advanced',
    },
  ],

  tools: {
    access: [
      'microsoft_word_create',
      'microsoft_word_create_from_template',
      'microsoft_word_read',
      'microsoft_word_update',
      'microsoft_word_append',
      'microsoft_word_replace_text',
      'microsoft_word_list',
      'microsoft_word_export_pdf',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'create':
            return 'microsoft_word_create'
          case 'create_from_template':
            return 'microsoft_word_create_from_template'
          case 'read':
            return 'microsoft_word_read'
          case 'update':
            return 'microsoft_word_update'
          case 'append':
            return 'microsoft_word_append'
          case 'replace_text':
            return 'microsoft_word_replace_text'
          case 'list':
            return 'microsoft_word_list'
          case 'export_pdf':
            return 'microsoft_word_export_pdf'
          default:
            throw new Error(`Invalid Microsoft Word operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const {
          oauthCredential,
          operation,
          documentId,
          templateDocumentId,
          replacements,
          driveId,
          name,
          content,
          appendContent,
          createFolderId,
          listFolderId,
          query,
          pageSize,
          pageToken,
          findText,
          replaceText,
          matchCase,
          fileName,
        } = params

        const base = { oauthCredential, driveId: optionalString(driveId) }

        switch (operation) {
          case 'create':
            return {
              ...base,
              name: requireString(name, 'Document name'),
              content: optionalString(content),
              folderId: optionalString(createFolderId),
            }
          case 'create_from_template':
            return {
              ...base,
              templateDocumentId: requireString(templateDocumentId, 'Template'),
              name: requireString(name, 'Document name'),
              replacements: optionalJson(replacements),
              matchCase: optionalBoolean(matchCase) ?? false,
              folderId: optionalString(createFolderId),
            }
          case 'read':
            return { ...base, documentId: requireString(documentId, 'Document') }
          case 'update':
            return {
              ...base,
              documentId: requireString(documentId, 'Document'),
              content: requireString(content, 'Content'),
            }
          case 'append':
            return {
              ...base,
              documentId: requireString(documentId, 'Document'),
              content: requireString(appendContent, 'Content to append'),
            }
          case 'replace_text':
            return {
              ...base,
              documentId: requireString(documentId, 'Document'),
              findText: requireRawString(findText, 'Find text'),
              replaceText: rawString(replaceText),
              matchCase: optionalBoolean(matchCase) ?? false,
            }
          case 'list':
            return {
              ...base,
              query: optionalString(query),
              folderId: optionalString(listFolderId),
              pageSize: optionalNumber(pageSize),
              pageToken: optionalString(pageToken),
            }
          case 'export_pdf':
            return {
              ...base,
              documentId: requireString(documentId, 'Document'),
              fileName: optionalString(fileName),
            }
          default:
            throw new Error(`Invalid Microsoft Word operation: ${operation}`)
        }
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'Microsoft Word access token' },
    documentId: { type: 'string', description: 'Document identifier (canonical param)' },
    templateDocumentId: {
      type: 'string',
      description: 'Template document identifier (canonical param)',
    },
    replacements: {
      type: 'string',
      description: 'JSON object mapping template placeholders to their values',
    },
    driveId: { type: 'string', description: 'Drive ID for SharePoint document libraries' },
    name: { type: 'string', description: 'Name for a newly created document' },
    content: { type: 'string', description: 'Document content for create and replace' },
    appendContent: { type: 'string', description: 'Text appended to an existing document' },
    createFolderId: { type: 'string', description: 'Folder to create the document in' },
    listFolderId: { type: 'string', description: 'Folder to list or search within' },
    query: { type: 'string', description: 'Search text for listing documents' },
    pageSize: { type: 'string', description: 'Maximum number of documents to return' },
    pageToken: { type: 'string', description: 'Continuation token for the next page of results' },
    findText: { type: 'string', description: 'Literal text to find in the document' },
    replaceText: { type: 'string', description: 'Text substituted for each match' },
    matchCase: { type: 'string', description: 'Whether find-and-replace is case-sensitive' },
    fileName: { type: 'string', description: 'File name for the exported PDF' },
  },

  outputs: {
    content: { type: 'string', description: 'Extracted document text (read operation)' },
    metadata: {
      type: 'json',
      description:
        'Document metadata (documentId, name, mimeType, webViewLink, size, createdTime, modifiedTime)',
    },
    updatedContent: {
      type: 'boolean',
      description: 'Whether the document contents changed (replace and append operations)',
    },
    documents: {
      type: 'json',
      description:
        'Word documents that matched a list or search operation ([{documentId, name, mimeType, webViewLink, size, createdTime, modifiedTime}])',
    },
    nextPageToken: {
      type: 'string',
      description: 'Continuation token for the next page of list results, when more remain',
    },
    occurrencesChanged: {
      type: 'number',
      description:
        'How many occurrences were replaced (find-and-replace and create-from-template operations)',
    },
    file: { type: 'file', description: 'The exported PDF file (export operation)' },
  },
}

export const MicrosoftWordBlockMeta = {
  tags: ['microsoft-365', 'document-processing', 'cloud'],
  url: 'https://www.microsoft.com/microsoft-365/word',
  templates: [
    {
      icon: MicrosoftWordIcon,
      title: 'Word meeting-notes writer',
      prompt:
        'Build a workflow that takes a Fireflies meeting transcript, summarizes the decisions and action items, and creates a formatted Word document in the team OneDrive folder.',
      modules: ['agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['meeting', 'automation'],
      alsoIntegrations: ['fireflies', 'onedrive'],
    },
    {
      icon: MicrosoftWordIcon,
      title: 'Word contract reviewer',
      prompt:
        'Create a workflow that reads a Word contract, flags clauses that deviate from the standard template, writes the findings to a table, and posts a review summary in Teams.',
      modules: ['agent', 'tables', 'workflows'],
      category: 'operations',
      tags: ['legal', 'automation'],
      alsoIntegrations: ['microsoft_teams'],
    },
    {
      icon: MicrosoftWordIcon,
      title: 'Word weekly-report builder',
      prompt:
        'Build a scheduled weekly workflow that pulls metrics from a table, drafts a written status report, and appends the new week to a running Word document.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['analysis', 'automation'],
    },
    {
      icon: MicrosoftWordIcon,
      title: 'Word proposal generator',
      prompt:
        'Create a workflow triggered by a closed-won HubSpot deal that generates a tailored proposal document in Word, exports it as PDF, and emails it to the customer contact.',
      modules: ['agent', 'files', 'workflows'],
      category: 'sales',
      tags: ['sales', 'automation'],
      alsoIntegrations: ['hubspot', 'outlook'],
    },
    {
      icon: MicrosoftWordIcon,
      title: 'Word document knowledge sync',
      prompt:
        'Build a scheduled workflow that lists Word documents in a SharePoint library, reads each one, and syncs the extracted text into a knowledge base for retrieval.',
      modules: ['scheduled', 'knowledge-base', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'sync'],
      alsoIntegrations: ['sharepoint'],
    },
    {
      icon: MicrosoftWordIcon,
      title: 'Word policy translator',
      prompt:
        'Create a workflow that reads an internal policy document from Word, translates it into the requested language, and creates a localized Word copy alongside the original.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'automation'],
    },
    {
      icon: MicrosoftWordIcon,
      title: 'Word incident postmortem',
      prompt:
        'Build a workflow triggered by a resolved Linear incident that drafts a postmortem in Word from the issue timeline, exports it as PDF, and shares the PDF in the incident Slack channel.',
      modules: ['agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['devops', 'automation'],
      alsoIntegrations: ['linear', 'slack'],
    },
  ],
  skills: [
    {
      name: 'fill-word-template',
      description:
        'Generate a document from a formatted Word template by substituting its placeholders.',
      content:
        '# Fill a Word Template\n\nTurn an approved template into a finished document without touching the template itself.\n\n## Steps\n1. Run List Documents to locate the template and note its document id.\n2. Run Create from Template with that template, the name for the new document, and a Placeholder Values object mapping each placeholder to its value, for example {"{{customer_name}}": "Acme Corp"}.\n3. Read back occurrencesChanged; a count of 0 means the placeholders in the object do not match the ones in the template.\n\n## Output\nReport the new document name, its link, and how many placeholders were filled.',
    },
    {
      name: 'generate-contract-from-deal',
      description: 'Produce a contract or offer letter from deal data and deliver it as a PDF.',
      content:
        '# Generate a Contract from Deal Data\n\nProduce a signed-ready document from structured data.\n\n## Steps\n1. Collect the counterparty, amounts, and dates from the upstream CRM or form step.\n2. Run Create from Template against the standard agreement template, passing those values as Placeholder Values.\n3. Run Export as PDF on the new document so the recipient gets a fixed copy.\n4. Hand the PDF to an email or messaging step for delivery.\n\n## Output\nConfirm the document name, the filled placeholder count, and the PDF that was produced.',
    },
    {
      name: 'summarize-word-document',
      description: 'Read a Word document and produce a structured summary of its contents.',
      content:
        '# Summarize a Word Document\n\nTurn a long document into something a person can act on.\n\n## Steps\n1. Run List Documents to find the document, or take its id from an upstream step.\n2. Run Read Document to extract the text.\n3. Pass the text to an agent with instructions on what to pull out, such as decisions, owners, and dates.\n\n## Output\nReturn the summary along with the document name and link so the reader can open the source.',
    },
    {
      name: 'append-to-running-log',
      description: 'Add a new dated entry to the end of an existing Word document.',
      content:
        '# Append to a Running Log\n\nKeep one document growing instead of creating a new file each time.\n\n## Steps\n1. Run List Documents to find the log document.\n2. Compose the entry text, starting with the date so entries stay scannable.\n3. Run Append Content with that text; each non-empty line becomes its own paragraph and the existing content is left untouched.\n\n## Output\nConfirm what was appended and link to the updated document.',
    },
    {
      name: 'export-document-as-pdf',
      description: 'Convert a Word document to PDF for sharing or archiving.',
      content:
        '# Export a Document as PDF\n\nShare a fixed copy that renders the same everywhere.\n\n## Steps\n1. Identify the document, either from List Documents or from an upstream step that created it.\n2. Run Export as PDF, optionally setting the PDF File Name.\n3. Pass the returned file to an email, upload, or messaging step.\n\n## Output\nConfirm the PDF file name and where it was sent.',
    },
    {
      name: 'rebrand-across-documents',
      description:
        'Apply a naming or terminology change across a set of Word documents, headers and footers included.',
      content:
        '# Rebrand Across Documents\n\nRoll out a rename without opening each file.\n\n## Steps\n1. Run List Documents with a search query narrow enough to hit only the documents in scope, and review the list before editing anything.\n2. For each document, run Find and Replace Text with the old and new terms; headers and footers are covered along with the body.\n3. Track occurrencesChanged per document so a document that reports 0 can be checked by hand.\n\n## Output\nReport each document edited, its replacement count, and any that matched nothing.',
    },
    {
      name: 'localize-a-document',
      description: 'Produce a translated copy of a Word document without altering the original.',
      content:
        '# Localize a Document\n\nCreate a language variant while leaving the source intact.\n\n## Steps\n1. Run Read Document on the source to extract its text.\n2. Translate the text with an agent, keeping the heading and bullet markers so structure survives.\n3. Run Create Document with the translated text and a name that carries the locale, for example "Policy (de-DE)".\n\n## Output\nConfirm the new document name and link, and note that the source was not modified.',
    },
  ],
} as const satisfies BlockMeta
