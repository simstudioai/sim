import type {
  ElasticsearchDocumentResponse,
  ElasticsearchUpdateDocumentParams,
} from '@/tools/elasticsearch/types'
import {
  buildAuthHeaders,
  buildBaseUrl,
  optionalNumber,
  safeIndexPathSegment,
} from '@/tools/elasticsearch/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const updateDocumentTool: ToolConfig<
  ElasticsearchUpdateDocumentParams,
  ElasticsearchDocumentResponse
> = {
  id: 'elasticsearch_update_document',
  name: 'Elasticsearch Update Document',
  description: 'Partially update a document in Elasticsearch using doc merge.',
  version: '1.0.0',

  params: {
    deploymentType: {
      type: 'string',
      required: true,
      description: 'Deployment type: self_hosted or cloud',
    },
    host: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Elasticsearch host URL (for self-hosted)',
    },
    cloudId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Elastic Cloud ID (for cloud deployments)',
    },
    authMethod: {
      type: 'string',
      required: true,
      description: 'Authentication method: api_key or basic_auth',
    },
    apiKey: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Elasticsearch API key',
    },
    username: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Username for basic auth',
    },
    password: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Password for basic auth',
    },
    index: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Index name (e.g., "products", "logs-2024")',
    },
    documentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Document ID to update (e.g., "abc123", "user_456")',
    },
    document: {
      type: 'string',
      required: true,
      description: 'Partial document to merge as JSON string',
    },
    retryOnConflict: {
      type: 'number',
      required: false,
      description: 'Number of retries on version conflict',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = buildBaseUrl(params)
      let url = `${baseUrl}/${safeIndexPathSegment(params.index, 'index')}/_update/${safeUrlPathSegment(params.documentId, 'documentId')}`

      const retryOnConflict = optionalNumber(params.retryOnConflict, 'retryOnConflict')
      if (retryOnConflict !== undefined) {
        url += `?retry_on_conflict=${retryOnConflict}`
      }

      return url
    },
    method: 'POST',
    headers: (params) => buildAuthHeaders(params),
    body: (params) => {
      try {
        return { doc: JSON.parse(params.document) }
      } catch {
        throw new Error('Invalid JSON document')
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        _index: data._index,
        _id: data._id,
        _version: data._version,
        result: data.result,
      },
    }
  },

  outputs: {
    _index: {
      type: 'string',
      description: 'Index name',
    },
    _id: {
      type: 'string',
      description: 'Document ID',
    },
    _version: {
      type: 'number',
      description: 'New document version',
    },
    result: {
      type: 'string',
      description: 'Operation result (updated or noop)',
    },
  },
}
