import type {
  ElasticsearchDeleteDocumentParams,
  ElasticsearchDocumentResponse,
} from '@/tools/elasticsearch/types'
import { buildAuthHeaders, buildBaseUrl, safeIndexPathSegment } from '@/tools/elasticsearch/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const deleteDocumentTool: ToolConfig<
  ElasticsearchDeleteDocumentParams,
  ElasticsearchDocumentResponse
> = {
  id: 'elasticsearch_delete_document',
  name: 'Elasticsearch Delete Document',
  description: 'Delete a document from Elasticsearch by ID.',
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
      description: 'Document ID to delete (e.g., "abc123", "user_456")',
    },
    refresh: {
      type: 'string',
      required: false,
      description: 'Refresh policy: true, false, or wait_for',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = buildBaseUrl(params)
      let url = `${baseUrl}/${safeIndexPathSegment(params.index, 'index')}/_doc/${safeUrlPathSegment(params.documentId, 'documentId')}`

      if (params.refresh) {
        url += `?refresh=${encodeURIComponent(params.refresh)}`
      }

      return url
    },
    method: 'DELETE',
    headers: (params) => buildAuthHeaders(params),
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
      description: 'Document version',
    },
    result: {
      type: 'string',
      description:
        'Always "deleted". A missing document fails the call with a 404 error rather than returning "not_found".',
    },
  },
}
