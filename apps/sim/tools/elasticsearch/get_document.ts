import type {
  ElasticsearchDocumentResponse,
  ElasticsearchGetDocumentParams,
} from '@/tools/elasticsearch/types'
import { buildAuthHeaders, buildBaseUrl } from '@/tools/elasticsearch/utils'
import type { ToolConfig } from '@/tools/types'

export const getDocumentTool: ToolConfig<
  ElasticsearchGetDocumentParams,
  ElasticsearchDocumentResponse
> = {
  id: 'elasticsearch_get_document',
  name: 'Elasticsearch Get Document',
  description: 'Retrieve a document by ID from Elasticsearch.',
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
      description: 'Document ID to retrieve (e.g., "abc123", "user_456")',
    },
    sourceIncludes: {
      type: 'string',
      required: false,
      description: 'Comma-separated list of fields to include',
    },
    sourceExcludes: {
      type: 'string',
      required: false,
      description: 'Comma-separated list of fields to exclude',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = buildBaseUrl(params)
      let url = `${baseUrl}/${encodeURIComponent(params.index)}/_doc/${encodeURIComponent(params.documentId)}`

      const queryParams: string[] = []
      if (params.sourceIncludes) {
        queryParams.push(`_source_includes=${encodeURIComponent(params.sourceIncludes)}`)
      }
      if (params.sourceExcludes) {
        queryParams.push(`_source_excludes=${encodeURIComponent(params.sourceExcludes)}`)
      }
      if (queryParams.length > 0) {
        url += `?${queryParams.join('&')}`
      }

      return url
    },
    method: 'GET',
    headers: (params) => buildAuthHeaders(params),
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
            found: false,
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
        found: data.found,
        _source: data._source,
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
      optional: true,
    },
    found: {
      type: 'boolean',
      description: 'Whether the document was found',
    },
    _source: {
      type: 'json',
      description: 'Document content',
      optional: true,
    },
  },
}
