import type {
  ElasticsearchDocumentResponse,
  ElasticsearchIndexDocumentParams,
} from '@/tools/elasticsearch/types'
import { buildAuthHeaders, buildBaseUrl, safeIndexPathSegment } from '@/tools/elasticsearch/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const indexDocumentTool: ToolConfig<
  ElasticsearchIndexDocumentParams,
  ElasticsearchDocumentResponse
> = {
  id: 'elasticsearch_index_document',
  name: 'Elasticsearch Index Document',
  description: 'Index (create or update) a document in Elasticsearch.',
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
      description: 'Target index name (e.g., "products", "logs-2024")',
    },
    documentId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Document ID (e.g., "abc123", "user_456"). Auto-generated if not provided',
    },
    document: {
      type: 'string',
      required: true,
      description: 'Document body as JSON string',
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
      let url = `${baseUrl}/${safeIndexPathSegment(params.index, 'index')}/_doc`
      if (params.documentId) {
        url += `/${safeUrlPathSegment(params.documentId, 'documentId')}`
      }
      if (params.refresh) {
        url += `?refresh=${encodeURIComponent(params.refresh)}`
      }
      return url
    },
    method: (params) => (params.documentId ? 'PUT' : 'POST'),
    headers: (params) => buildAuthHeaders(params),
    body: (params) => {
      try {
        return JSON.parse(params.document)
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
      description: 'Index where the document was stored',
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
      description: 'Operation result (created or updated)',
    },
  },
}
