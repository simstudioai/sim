import type { GoogleDocsInsertImageResponse, GoogleDocsToolParams } from '@/tools/google_docs/types'
import {
  buildBatchUpdateMetadata,
  buildInsertLocation,
  resolveDocumentId,
} from '@/tools/google_docs/utils'
import type { ToolConfig } from '@/tools/types'

export const insertImageTool: ToolConfig<GoogleDocsToolParams, GoogleDocsInsertImageResponse> = {
  id: 'google_docs_insert_image',
  name: 'Insert Image into Google Docs Document',
  description:
    'Insert an inline image from a public URL into a Google Docs document. The image must be publicly accessible and under 50 MB. When no index is provided, the image is appended to the end of the document.',
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
      description: 'The ID of the document to insert the image into',
    },
    imageUrl: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The publicly accessible URL of the image to insert',
    },
    index: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The 1-based character index at which to insert the image. When omitted, the image is appended to the end of the document.',
    },
    width: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional image width in points (PT)',
    },
    height: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional image height in points (PT)',
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
      if (!params.imageUrl) {
        throw new Error('Image URL is required')
      }

      const insertInlineImage: Record<string, unknown> = {
        ...buildInsertLocation(params.index),
        uri: params.imageUrl,
      }

      const objectSize: Record<string, unknown> = {}
      if (typeof params.width === 'number' && Number.isFinite(params.width)) {
        objectSize.width = { magnitude: params.width, unit: 'PT' }
      }
      if (typeof params.height === 'number' && Number.isFinite(params.height)) {
        objectSize.height = { magnitude: params.height, unit: 'PT' }
      }
      if (Object.keys(objectSize).length > 0) {
        insertInlineImage.objectSize = objectSize
      }

      return {
        requests: [{ insertInlineImage }],
      }
    },
  },

  transformResponse: async (response: Response) => {
    const responseText = await response.text()
    const data = responseText.trim() ? JSON.parse(responseText) : {}
    const metadata = buildBatchUpdateMetadata(data, response.url)
    const objectId = data.replies?.[0]?.insertInlineImage?.objectId ?? null

    return {
      success: true,
      output: {
        objectId,
        metadata,
      },
    }
  },

  outputs: {
    objectId: {
      type: 'string',
      description: 'The ID of the inserted inline image object',
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
