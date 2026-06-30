import type {
  GoogleDocsDeleteContentRangeResponse,
  GoogleDocsToolParams,
} from '@/tools/google_docs/types'
import {
  buildBatchUpdateMetadata,
  buildContentRange,
  resolveDocumentId,
} from '@/tools/google_docs/utils'
import type { ToolConfig } from '@/tools/types'

export const deleteContentRangeTool: ToolConfig<
  GoogleDocsToolParams,
  GoogleDocsDeleteContentRangeResponse
> = {
  id: 'google_docs_delete_content_range',
  name: 'Delete Content Range in Google Docs Document',
  description:
    'Delete all content between a start and end character index in a Google Docs document. The endIndex is exclusive and must be greater than the startIndex.',
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
      description: 'The ID of the document to delete content from',
    },
    startIndex: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The 1-based start character index of the range to delete (inclusive)',
    },
    endIndex: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The end character index of the range to delete (exclusive)',
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
      const range = buildContentRange(params.startIndex, params.endIndex)
      return {
        requests: [
          {
            deleteContentRange: { range },
          },
        ],
      }
    },
  },

  transformResponse: async (response: Response) => {
    const responseText = await response.text()
    const data = responseText.trim() ? JSON.parse(responseText) : {}
    const metadata = buildBatchUpdateMetadata(data, response.url)

    return {
      success: true,
      output: {
        updatedContent: true,
        metadata,
      },
    }
  },

  outputs: {
    updatedContent: {
      type: 'boolean',
      description: 'Indicates if the content range was deleted successfully',
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
