import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  MicrosoftWordToolParams,
  MicrosoftWordUpdateResponse,
} from '@/tools/microsoft_word/types'
import type { ToolConfig } from '@/tools/types'

export const appendTool: ToolConfig<MicrosoftWordToolParams, MicrosoftWordUpdateResponse> = {
  id: 'microsoft_word_append',
  name: 'Append to Microsoft Word Document',
  description:
    'Append plain-text paragraphs to the end of an existing Microsoft Word (.docx) document, leaving the existing content and formatting intact. Fails rather than overwriting if someone else changed the document while the edit was in flight.',
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
      description: 'The drive item ID of the Word document to append to',
    },
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The text to append. Each non-empty line becomes a paragraph at the end of the document. Markdown is not converted here — use Update to rewrite a document with formatting.',
    },
    driveId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The ID of the drive containing the document. Required for SharePoint. If omitted, uses the personal OneDrive.',
    },
  },

  request: {
    url: '/api/tools/microsoft_word/append',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      accessToken: params.accessToken,
      documentId: params.documentId,
      content: params.content,
      driveId: params.driveId,
    }),
  },

  outputs: {
    updatedContent: {
      type: 'boolean',
      description: 'Whether the paragraphs were appended to the document',
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
