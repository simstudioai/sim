import type {
  GoogleDocsDeleteParagraphBulletsResponse,
  GoogleDocsToolParams,
} from '@/tools/google_docs/types'
import {
  buildBatchUpdateMetadata,
  buildContentRange,
  resolveDocumentId,
} from '@/tools/google_docs/utils'
import type { ToolConfig } from '@/tools/types'

export const deleteParagraphBulletsTool: ToolConfig<
  GoogleDocsToolParams,
  GoogleDocsDeleteParagraphBulletsResponse
> = {
  id: 'google_docs_delete_paragraph_bullets',
  name: 'Delete Paragraph Bullets in Google Docs Document',
  description:
    'Remove bullet or numbered list formatting from the paragraphs overlapping a range of text in a Google Docs document, identified by its start and end character index.',
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
    startIndex: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The zero-based start character index of the range to clear bullets from (inclusive)',
    },
    endIndex: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The end character index of the range to clear bullets from (exclusive)',
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
            deleteParagraphBullets: { range },
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
      description: 'Indicates if the bullets were removed successfully',
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
