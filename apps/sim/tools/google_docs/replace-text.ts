import type { GoogleDocsReplaceTextResponse, GoogleDocsToolParams } from '@/tools/google_docs/types'
import {
  buildBatchUpdateMetadata,
  parseOptionalBoolean,
  resolveDocumentId,
} from '@/tools/google_docs/utils'
import type { ToolConfig } from '@/tools/types'

export const replaceTextTool: ToolConfig<GoogleDocsToolParams, GoogleDocsReplaceTextResponse> = {
  id: 'google_docs_replace_text',
  name: 'Find and Replace Text in Google Docs Document',
  description:
    'Replace all occurrences of a search string with new text across a Google Docs document.',
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
      description: 'The ID of the document to update',
    },
    searchText: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The text to find',
    },
    replaceText: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The text to replace matches with. Use an empty string to delete matches.',
    },
    matchCase: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the search should be case sensitive. Defaults to false.',
    },
  },
  request: {
    url: (params) => {
      const documentId = resolveDocumentId(params)
      return `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`
    },
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => {
      if (!params.searchText) {
        throw new Error('Search text is required')
      }
      return {
        requests: [
          {
            replaceAllText: {
              containsText: {
                text: params.searchText,
                matchCase: parseOptionalBoolean(params.matchCase) ?? false,
              },
              replaceText: params.replaceText ?? '',
            },
          },
        ],
      }
    },
  },

  transformResponse: async (response: Response) => {
    const responseText = await response.text()
    const data = responseText.trim() ? JSON.parse(responseText) : {}
    const metadata = buildBatchUpdateMetadata(data, response.url)
    const occurrencesChanged = Number(data.replies?.[0]?.replaceAllText?.occurrencesChanged ?? 0)

    return {
      success: true,
      output: {
        occurrencesChanged,
        metadata,
      },
    }
  },

  outputs: {
    occurrencesChanged: {
      type: 'number',
      description: 'The number of occurrences that were replaced',
    },
    metadata: {
      type: 'json',
      description: 'Updated document metadata including ID, title, and URL',
      properties: {
        documentId: { type: 'string', description: 'Google Docs document ID' },
        title: { type: 'string', description: 'Document title' },
        mimeType: { type: 'string', description: 'Document MIME type' },
        url: { type: 'string', description: 'Document URL' },
      },
    },
  },
}
