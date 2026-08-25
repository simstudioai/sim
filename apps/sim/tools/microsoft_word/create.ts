import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  MicrosoftWordCreateResponse,
  MicrosoftWordToolParams,
} from '@/tools/microsoft_word/types'
import type { ToolConfig } from '@/tools/types'

export const createTool: ToolConfig<MicrosoftWordToolParams, MicrosoftWordCreateResponse> = {
  id: 'microsoft_word_create',
  name: 'Create Microsoft Word Document',
  description:
    'Create a new Microsoft Word (.docx) document in OneDrive or SharePoint from text content. Supports Markdown headings (# ## ###), bullets (-), and inline **bold** / *italic*.',
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
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The name of the document to create (e.g., "Q3 Report"). A .docx extension is added when missing.',
    },
    content: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The text content of the document. Markdown headings (# ## ###), bullets (- item), and inline **bold** / *italic* are converted to Word formatting; every other line becomes a paragraph.',
    },
    folderId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The ID of the folder to create the document in. If omitted, the document is created in the drive root.',
    },
    driveId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The ID of the drive to create the document in. Required for SharePoint. If omitted, uses the personal OneDrive.',
    },
  },

  request: {
    url: '/api/tools/microsoft_word/create',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      accessToken: params.accessToken,
      name: params.name,
      content: params.content,
      folderId: params.folderId,
      driveId: params.driveId,
    }),
  },

  outputs: {
    metadata: {
      type: 'object',
      description: 'Metadata for the created document',
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
