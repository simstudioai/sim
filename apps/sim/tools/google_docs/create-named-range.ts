import type {
  GoogleDocsCreateNamedRangeResponse,
  GoogleDocsToolParams,
} from '@/tools/google_docs/types'
import {
  buildBatchUpdateMetadata,
  buildContentRange,
  resolveDocumentId,
} from '@/tools/google_docs/utils'
import type { ToolConfig } from '@/tools/types'

export const createNamedRangeTool: ToolConfig<
  GoogleDocsToolParams,
  GoogleDocsCreateNamedRangeResponse
> = {
  id: 'google_docs_create_named_range',
  name: 'Create Named Range in Google Docs Document',
  description:
    'Create a named range over a span of content in a Google Docs document so it can be referenced or deleted later. The name may be 1-256 characters and need not be unique.',
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
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the range to create (1-256 characters)',
    },
    startIndex: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The start character index (the document body starts at index 1) of the range (inclusive)',
    },
    endIndex: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The end character index of the range (exclusive)',
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
      const name = params.name ? String(params.name).trim() : ''
      if (!name) {
        throw new Error('name is required')
      }
      if (name.length > 256) {
        throw new Error('name must be 256 characters or fewer')
      }
      const range = buildContentRange(params.startIndex, params.endIndex)
      return {
        requests: [
          {
            createNamedRange: { name, range },
          },
        ],
      }
    },
  },

  transformResponse: async (response: Response) => {
    const responseText = await response.text()
    const data = responseText.trim() ? JSON.parse(responseText) : {}
    const metadata = buildBatchUpdateMetadata(data, response.url)
    const namedRangeId = data.replies?.[0]?.createNamedRange?.namedRangeId ?? null

    return {
      success: true,
      output: {
        namedRangeId,
        metadata,
      },
    }
  },

  outputs: {
    namedRangeId: {
      type: 'string',
      description: 'The ID of the created named range',
      optional: true,
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
