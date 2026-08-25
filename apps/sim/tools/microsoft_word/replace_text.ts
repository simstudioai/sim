import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  MicrosoftWordReplaceTextResponse,
  MicrosoftWordToolParams,
} from '@/tools/microsoft_word/types'
import type { ToolConfig } from '@/tools/types'

export const replaceTextTool: ToolConfig<
  MicrosoftWordToolParams,
  MicrosoftWordReplaceTextResponse
> = {
  id: 'microsoft_word_replace_text',
  name: 'Replace Text in Microsoft Word Document',
  description:
    'Find and replace text throughout a Microsoft Word (.docx) document, including its headers and footers. Use this to fill placeholders in a template document. Fails rather than overwriting if someone else changed the document while the edit was in flight.',
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
      description: 'The drive item ID of the Word document to edit',
    },
    findText: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The literal text to find (e.g., "{{customer_name}}"). Matched as plain text, not a pattern, and never across a paragraph break.',
    },
    replaceText: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The text to substitute for each match. Omit to delete the matched text.',
    },
    matchCase: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether matching is case-sensitive. Defaults to false.',
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
    url: '/api/tools/microsoft_word/replace-text',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      accessToken: params.accessToken,
      documentId: params.documentId,
      findText: params.findText,
      replaceText: params.replaceText,
      matchCase: params.matchCase,
      driveId: params.driveId,
    }),
  },

  outputs: {
    occurrencesChanged: {
      type: 'number',
      description: 'How many occurrences of the search text were replaced',
    },
    metadata: {
      type: 'object',
      description: 'Metadata for the edited document',
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
