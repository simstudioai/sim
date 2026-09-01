import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  MicrosoftWordToolParams,
  MicrosoftWordUpdateResponse,
} from '@/tools/microsoft_word/types'
import type { InternalToolConfig } from '@/tools/types'

type UpdateToolConfig = InternalToolConfig<MicrosoftWordToolParams, MicrosoftWordUpdateResponse>

export const updateTool: UpdateToolConfig = {
  id: 'microsoft_word_update',
  name: 'Update Microsoft Word Document',
  description:
    'Replace the entire contents of an existing Microsoft Word (.docx) document with new text. The previous content and its formatting are discarded — use Append to add to a document instead.',
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
    documentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The drive item ID of the Word document to replace',
    },
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The new text content of the document. Markdown headings (# ## ###), bullets (- item), and inline **bold** / *italic* are converted to Word formatting; every other line becomes a paragraph.',
    },
    driveId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The ID of the drive containing the document. Required for SharePoint. If omitted, uses the personal OneDrive.',
    },
  },

  operation: {
    input: (params) => ({
      accessToken: params.accessToken,
      documentId: params.documentId,
      content: params.content,
      driveId: params.driveId,
    }),
  },

  outputs: {
    updatedContent: {
      type: 'boolean',
      description: 'Whether the document content was replaced',
    },
    metadata: {
      type: 'object',
      description: 'Metadata for the updated document',
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
