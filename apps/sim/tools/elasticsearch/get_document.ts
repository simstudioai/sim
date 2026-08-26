import type {
  ElasticsearchDocumentResponse,
  ElasticsearchGetDocumentParams,
} from '@/tools/elasticsearch/types'
import { buildAuthHeaders, buildBaseUrl, safeIndexPathSegment } from '@/tools/elasticsearch/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const getDocumentTool: ToolConfig<
  ElasticsearchGetDocumentParams,
  ElasticsearchDocumentResponse
> = {
  id: 'elasticsearch_get_document',
  name: 'Elasticsearch Get Document',
  description: 'Retrieve a document by ID from Elasticsearch.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.ELASTICSEARCH_ERRORS,

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
      let url = `${baseUrl}/${safeIndexPathSegment(params.index, 'index')}/_doc/${safeUrlPathSegment(params.documentId, 'documentId')}`

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
  },

  transformResponse: async (response: Response) => {
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
    },
    found: {
      type: 'boolean',
      description:
        'Always true. A missing document fails the call with a 404 error rather than returning found: false.',
    },
    _source: {
      type: 'json',
      description: 'Document content',
    },
  },
}
