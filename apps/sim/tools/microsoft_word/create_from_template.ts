import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  MicrosoftWordCreateFromTemplateResponse,
  MicrosoftWordToolParams,
} from '@/tools/microsoft_word/types'
import type { InternalToolConfig } from '@/tools/types'

export const createFromTemplateTool: InternalToolConfig<
  MicrosoftWordToolParams,
  MicrosoftWordCreateFromTemplateResponse
> = {
  id: 'microsoft_word_create_from_template',
  name: 'Create Microsoft Word Document from Template',
  description:
    'Copy an existing Microsoft Word (.docx) template to a new document and fill its placeholders. The template keeps all of its formatting, styles, headers, and footers, and is never modified. An existing document with the same name is never overwritten — the new one is given a unique name instead.',
  version: '1.0',
  errorExtractor: ErrorExtractorId.MICROSOFT_GRAPH_ERRORS,

  oauth: {
    required: true,
    provider: 'microsoft-word',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Microsoft Graph API',
    },
    templateDocumentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The drive item ID of the Word template to copy',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The name of the document to create (e.g., "Acme — Services Agreement"). A .docx extension is added when missing.',
    },
    replacements: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'A JSON object mapping each placeholder in the template to its value, e.g. {"{{customer_name}}": "Acme Corp", "{{date}}": "2026-01-31"}. Placeholders not present in the template are ignored.',
    },
    matchCase: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether placeholder matching is case-sensitive. Defaults to false.',
    },
    folderId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The ID of the folder to create the new document in. If omitted, the drive root is used.',
    },
    driveId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The ID of the drive holding the template and the new document. Required for SharePoint. If omitted, uses the personal OneDrive.',
    },
  },

  operation: {
    input: (params) => ({
      accessToken: params.accessToken,
      templateDocumentId: params.templateDocumentId,
      name: params.name,
      replacements: params.replacements,
      matchCase: params.matchCase,
      folderId: params.folderId,
      driveId: params.driveId,
    }),
  },

  outputs: {
    occurrencesChanged: {
      type: 'number',
      description: 'How many placeholder occurrences were filled in the new document',
    },
    metadata: {
      type: 'object',
      description: 'Metadata for the newly created document',
      properties: {
        documentId: { type: 'string', description: 'The drive item ID of the document' },
        name: { type: 'string', description: 'The document file name', optional: true },
        mimeType: { type: 'string', description: 'The document MIME type', optional: true },
        webViewLink: {
          type: 'string',
          description: 'Browser URL for opening the document',
          optional: true,
        },
        size: { type: 'number', description: 'Document size in bytes', optional: true },
        createdTime: { type: 'string', description: 'ISO 8601 creation time', optional: true },
        modifiedTime: {
          type: 'string',
          description: 'ISO 8601 last modification time',
          optional: true,
        },
      },
    },
  },
}
