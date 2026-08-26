import type {
  ElasticsearchDeleteIndexParams,
  ElasticsearchIndexResponse,
} from '@/tools/elasticsearch/types'
import { buildAuthHeaders, buildBaseUrl, safeIndexPathSegment } from '@/tools/elasticsearch/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const deleteIndexTool: ToolConfig<
  ElasticsearchDeleteIndexParams,
  ElasticsearchIndexResponse
> = {
  id: 'elasticsearch_delete_index',
  name: 'Elasticsearch Delete Index',
  description: 'Delete an index and all its documents. This operation is irreversible.',
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
      description: 'Index name to delete (e.g., "products", "logs-2024")',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = buildBaseUrl(params)
      return `${baseUrl}/${safeIndexPathSegment(params.index, 'index')}`
    },
    method: 'DELETE',
    headers: (params) => buildAuthHeaders(params),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        acknowledged: data.acknowledged,
      },
    }
  },

  outputs: {
    acknowledged: {
      type: 'boolean',
      description: 'Whether the deletion was acknowledged',
    },
  },
}
