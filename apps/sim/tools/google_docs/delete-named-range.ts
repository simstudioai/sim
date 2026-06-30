import type {
  GoogleDocsDeleteNamedRangeResponse,
  GoogleDocsToolParams,
} from '@/tools/google_docs/types'
import { buildBatchUpdateMetadata, resolveDocumentId } from '@/tools/google_docs/utils'
import type { ToolConfig } from '@/tools/types'

export const deleteNamedRangeTool: ToolConfig<
  GoogleDocsToolParams,
  GoogleDocsDeleteNamedRangeResponse
> = {
  id: 'google_docs_delete_named_range',
  name: 'Delete Named Range in Google Docs Document',
  description:
    'Delete one or more named ranges from a Google Docs document by their ID or by name. Provide exactly one of namedRangeId or name; deleting by name removes all ranges sharing that name. The content itself is not removed.',
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
    namedRangeId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The ID of the named range to delete. Provide exactly one of namedRangeId or namedRangeName.',
    },
    namedRangeName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The name of the named range(s) to delete. All ranges sharing this name are removed. Provide exactly one of namedRangeId or namedRangeName.',
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
      const namedRangeId = params.namedRangeId ? String(params.namedRangeId).trim() : ''
      const name = params.namedRangeName ? String(params.namedRangeName).trim() : ''
      if (!namedRangeId && !name) {
        throw new Error('Either namedRangeId or namedRangeName is required')
      }
      if (namedRangeId && name) {
        throw new Error('Provide exactly one of namedRangeId or namedRangeName, not both')
      }
      const deleteNamedRange = namedRangeId ? { namedRangeId } : { name }
      return {
        requests: [{ deleteNamedRange }],
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
      description: 'Indicates if the named range(s) were deleted successfully',
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
