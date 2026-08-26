import type {
  ElasticsearchListIndicesParams,
  ElasticsearchListIndicesResponse,
} from '@/tools/elasticsearch/types'
import { buildAuthHeaders, buildBaseUrl } from '@/tools/elasticsearch/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

/**
 * Builds the base URL for Elasticsearch connections.
 * Supports both self-hosted and Elastic Cloud deployments.
 */
export const listIndicesTool: ToolConfig<
  ElasticsearchListIndicesParams,
  ElasticsearchListIndicesResponse
> = {
  id: 'elasticsearch_list_indices',
  name: 'Elasticsearch List Indices',
  description:
    'List all indices in the Elasticsearch cluster with their health, status, and statistics.',
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
  },

  request: {
    url: (params) => {
      const baseUrl = buildBaseUrl(params)
      return `${baseUrl}/_cat/indices?format=json`
    },
    method: 'GET',
    headers: (params) => buildAuthHeaders(params),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    const indices = data
      .filter((item: Record<string, unknown>) => {
        const indexName = item.index as string
        return !indexName.startsWith('.')
      })
      .map((item: Record<string, unknown>) => ({
        index: item.index as string,
        health: item.health as string,
        status: item.status as string,
        docsCount: Number.parseInt(item['docs.count'] as string, 10) || 0,
        storeSize: (item['store.size'] as string) || '0b',
        primaryShards: Number.parseInt(item.pri as string, 10) || 0,
        replicaShards: Number.parseInt(item.rep as string, 10) || 0,
      }))

    return {
      success: true,
      output: {
        message: `Found ${indices.length} indices`,
        indices,
      },
    }
  },

  outputs: {
    message: {
      type: 'string',
      description: 'Summary message about the indices',
    },
    indices: {
      type: 'json',
      description: 'Array of index information objects',
    },
  },
}
