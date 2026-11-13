import type { GoogleDocsReadResponse, GoogleDocsToolParams } from '@/tools/google_docs/types'
import {
  extractTextFromDocument,
  flattenDocumentTabs,
  parseOptionalBoolean,
  resolveDocumentId,
} from '@/tools/google_docs/utils'
import type { ToolConfig } from '@/tools/types'

const SUGGESTIONS_VIEW_MODES = new Set([
  'DEFAULT_FOR_CURRENT_ACCESS',
  'SUGGESTIONS_INLINE',
  'PREVIEW_SUGGESTIONS_ACCEPTED',
  'PREVIEW_WITHOUT_SUGGESTIONS',
])

export const readTool: ToolConfig<GoogleDocsToolParams, GoogleDocsReadResponse> = {
  id: 'google_docs_read',
  name: 'Read Google Docs Document',
  description: 'Read content from a Google Docs document',
  version: '1.0',

  oauth: {
    required: true,
    provider: 'google-docs',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Google Docs API',
    },
    documentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Google Docs document ID',
    },
    includeTabsContent: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'When true, reads every tab of the document: content holds the text of all tabs in order and tabs lists each tab with its own text. Default: false (only the first tab is read).',
    },
    suggestionsViewMode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'How suggested edits appear in the returned text. One of: DEFAULT_FOR_CURRENT_ACCESS (default), SUGGESTIONS_INLINE, PREVIEW_SUGGESTIONS_ACCEPTED, PREVIEW_WITHOUT_SUGGESTIONS.',
    },
  },

  request: {
    url: (params) => {
      const documentId = resolveDocumentId(params)
      const url = new URL(`https://docs.googleapis.com/v1/documents/${documentId}`)
      if (parseOptionalBoolean(params.includeTabsContent)) {
        url.searchParams.set('includeTabsContent', 'true')
      }
      const mode = params.suggestionsViewMode?.trim().toUpperCase()
      if (mode) {
        if (!SUGGESTIONS_VIEW_MODES.has(mode)) {
          throw new Error(
            'suggestionsViewMode must be one of: DEFAULT_FOR_CURRENT_ACCESS, SUGGESTIONS_INLINE, PREVIEW_SUGGESTIONS_ACCEPTED, PREVIEW_WITHOUT_SUGGESTIONS'
          )
        }
        url.searchParams.set('suggestionsViewMode', mode)
      }
      return url.toString()
    },
    method: 'GET',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    const tabs = flattenDocumentTabs(data.tabs)
    const content =
      tabs.length > 0 && !data.body
        ? tabs.map((tab) => tab.content).join('')
        : extractTextFromDocument(data)

    const metadata = {
      documentId: data.documentId,
      title: data.title || 'Untitled Document',
      mimeType: 'application/vnd.google-apps.document',
      url: `https://docs.google.com/document/d/${data.documentId}/edit`,
      revisionId: data.revisionId ?? null,
    }

    return {
      success: true,
      output: {
        content,
        metadata,
        tabs,
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Extracted document text content' },
    metadata: {
      type: 'json',
      description: 'Document metadata including ID, title, and URL',
      properties: {
        documentId: { type: 'string', description: 'Google Docs document ID' },
        title: { type: 'string', description: 'Document title' },
        mimeType: { type: 'string', description: 'Document MIME type' },
        url: { type: 'string', description: 'Document URL' },
        revisionId: {
          type: 'string',
          description: 'Revision ID of the document as read',
          optional: true,
        },
      },
    },
    tabs: {
      type: 'array',
      description:
        'Every tab in the document, depth-first (populated only when includeTabsContent is true)',
      optional: true,
      items: {
        type: 'object',
        properties: {
          tabId: { type: 'string', description: 'Tab ID', optional: true },
          title: { type: 'string', description: 'Tab title', optional: true },
          parentTabId: { type: 'string', description: 'Parent tab ID', optional: true },
          index: {
            type: 'number',
            description: 'Zero-based index within the parent',
            optional: true,
          },
          nestingLevel: { type: 'number', description: 'Depth of the tab', optional: true },
          content: { type: 'string', description: 'Extracted text content of the tab' },
        },
      },
    },
  },
}
