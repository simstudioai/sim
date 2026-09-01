import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  MicrosoftWordReadResponse,
  MicrosoftWordToolParams,
} from '@/tools/microsoft_word/types'
import type { InternalToolConfig } from '@/tools/types'

export const readTool: InternalToolConfig<MicrosoftWordToolParams, MicrosoftWordReadResponse> = {
  id: 'microsoft_word_read',
  name: 'Read Microsoft Word Document',
  description:
    'Read the text content of a Microsoft Word (.docx) document stored in OneDrive or SharePoint.',
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
      description: 'The drive item ID of the Word document to read',
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
      driveId: params.driveId,
    }),
  },

  outputs: {
    content: { type: 'string', description: 'The extracted text content of the document' },
    metadata: {
      type: 'object',
      description: 'Metadata for the document that was read',
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
