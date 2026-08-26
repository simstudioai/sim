import type {
  ElasticsearchGetIndexParams,
  ElasticsearchIndexInfoMap,
  ElasticsearchIndexInfoResponse,
} from '@/tools/elasticsearch/types'
import { buildAuthHeaders, buildBaseUrl, safeIndexPathSegment } from '@/tools/elasticsearch/utils'
import type { ToolConfig } from '@/tools/types'

export const getIndexTool: ToolConfig<ElasticsearchGetIndexParams, ElasticsearchIndexInfoResponse> =
  {
    id: 'elasticsearch_get_index',
    name: 'Elasticsearch Get Index',
    description:
      'Retrieve index information including settings, mappings, and aliases. Accepts a comma-separated list of indices, data streams, and aliases, and supports wildcards.',
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
        description:
          'Index, data stream, or alias to retrieve info for. Accepts a comma-separated list and wildcards (e.g., "products", "logs-2024", "logs-*", "a,b").',
      },
    },

    request: {
      url: (params) => {
        const baseUrl = buildBaseUrl(params)
        return `${baseUrl}/${safeIndexPathSegment(params.index, 'index')}`
      },
      method: 'GET',
      headers: (params) => buildAuthHeaders(params),
    },

    /**
     * Elasticsearch keys this response by resolved index name, one entry per
     * matched target. A wildcard (`logs-*`) or comma-separated list (`a,b`)
     * therefore returns several entries, so taking a single key would discard
     * the rest with no error. Every entry is preserved under `indices`, and
     * `matchedCount` makes a multi-target result visible without inspecting it.
     *
     * `index`/`aliases`/`mappings`/`settings` stay flattened from the first
     * entry so the single-index shape the outputs declare is unchanged. That
     * flattening is also lossy in a second way — an entry can carry
     * `data_stream` and `lifecycle`, which have no flattened slot — and
     * `indices` is where those survive intact.
     */
    transformResponse: async (response: Response) => {
      const data = (await response.json()) as ElasticsearchIndexInfoMap

      const indexNames = Object.keys(data)
      const [indexName] = indexNames
      const info = indexName ? data[indexName] : undefined

      return {
        success: true,
        output: {
          index: indexName ?? '',
          aliases: info?.aliases ?? {},
          mappings: info?.mappings ?? {},
          settings: info?.settings ?? {},
          indices: data,
          matchedCount: indexNames.length,
        },
      }
    },

    outputs: {
      index: {
        type: 'string',
        description: 'Resolved index name the information belongs to',
      },
      aliases: {
        type: 'json',
        description: 'Aliases defined on the index',
      },
      mappings: {
        type: 'json',
        description: 'Field mappings for the index',
      },
      settings: {
        type: 'json',
        description: 'Index settings',
      },
      indices: {
        type: 'json',
        description:
          'Every matched index keyed by its resolved name, each with its aliases, mappings, settings, and any data_stream or lifecycle. Populated for single- and multi-target requests alike.',
      },
      matchedCount: {
        type: 'number',
        description: 'How many indices, data streams, or aliases the target matched',
      },
    },
  }
