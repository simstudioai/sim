import type {
  ElasticsearchDeleteDocumentParams,
  ElasticsearchDocumentResponse,
} from '@/tools/elasticsearch/types'
import { buildAuthHeaders, buildBaseUrl } from '@/tools/elasticsearch/utils'
import type { ToolConfig } from '@/tools/types'

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
      let url = `${baseUrl}/${encodeURIComponent(params.index)}/_doc/${encodeURIComponent(params.documentId)}`

      if (params.refresh) {
        url += `?refresh=${params.refresh}`
      }

      return url
    },
    method: 'DELETE',
    headers: (params) => buildAuthHeaders(params),
    /**
     * `host` is a user-supplied origin, so a redirect to a *different* origin
     * must not carry the API key or Basic credentials with it. Credentials are
     * kept on a same-origin hop: a reverse proxy in front of Elasticsearch can
     * legitimately redirect within its own origin, and dropping the header
     * there would turn a valid request into a 401.
     *
     * `mode: 'legacy'` preserves the existing method and body replay semantics,
     * so the only behavior change is the cross-origin credential strip. Under
     * `'standard'` a 301/302 would rewrite POST to GET, breaking the `_search`,
     * `_count` and `_bulk` calls.
     */
    redirectPolicy: () => ({ mode: 'legacy', sendCredentialsOnCrossOriginRedirect: false }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      if (response.status === 404) {
        return {
          success: true,
          output: {
            _index: '',
            _id: '',
            result: 'not_found',
          },
        }
      }

      const errorText = await response.text()
      let errorMessage = `Elasticsearch error: ${response.status}`
      try {
        const errorJson = JSON.parse(errorText)
        errorMessage = errorJson.error?.reason || errorJson.error?.type || errorMessage
      } catch {
        errorMessage = errorText || errorMessage
      }
      return {
        success: false,
        output: { _index: '', _id: '' },
        error: errorMessage,
      }
    }

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
      description: 'Operation result (deleted or not_found)',
    },
  },
}
