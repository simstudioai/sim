import type {
  ElasticsearchSearchParams,
  ElasticsearchSearchResponse,
} from '@/tools/elasticsearch/types'
import {
  buildAuthHeaders,
  buildBaseUrl,
  optionalNumber,
  safeIndexPathSegment,
} from '@/tools/elasticsearch/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const searchTool: ToolConfig<ElasticsearchSearchParams, ElasticsearchSearchResponse> = {
  id: 'elasticsearch_search',
  name: 'Elasticsearch Search',
  description:
    'Search documents in Elasticsearch using Query DSL. Returns matching documents with scores and metadata.',
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
      description: 'Index name to search (e.g., "products", "logs-2024")',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Query DSL as JSON string. Example: {"match":{"title":"search term"}} or {"bool":{"must":[...]}}',
    },
    from: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Starting offset for pagination (e.g., 0, 10, 20). Default: 0',
    },
    size: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to return (e.g., 10, 25, 100). Default: 10',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Sort specification as JSON string. Example: [{"created_at":"desc"}] or [{"_score":"desc"},{"name":"asc"}]',
    },
    sourceIncludes: {
      type: 'string',
      required: false,
      description: 'Comma-separated list of fields to include in _source',
    },
    sourceExcludes: {
      type: 'string',
      required: false,
      description: 'Comma-separated list of fields to exclude from _source',
    },
    trackTotalHits: {
      type: 'boolean',
      required: false,
      description: 'Track accurate total hit count (default: true)',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = buildBaseUrl(params)
      return `${baseUrl}/${safeIndexPathSegment(params.index, 'index')}/_search`
    },
    method: 'POST',
    headers: (params) => buildAuthHeaders(params),
    body: (params) => {
      const body: Record<string, unknown> = {}

      if (params.query) {
        try {
          body.query = JSON.parse(params.query)
        } catch {
          throw new Error('Invalid JSON provided for query')
        }
      }

      const from = optionalNumber(params.from, 'from')
      if (from !== undefined) body.from = from

      const size = optionalNumber(params.size, 'size')
      if (size !== undefined) body.size = size

      if (params.sort) {
        try {
          body.sort = JSON.parse(params.sort)
        } catch {
          throw new Error('Invalid JSON provided for sort')
        }
      }

      if (params.sourceIncludes || params.sourceExcludes) {
        body._source = {}
        if (params.sourceIncludes) {
          ;(body._source as Record<string, unknown>).includes = params.sourceIncludes
            .split(',')
            .map((s) => s.trim())
        }
        if (params.sourceExcludes) {
          ;(body._source as Record<string, unknown>).excludes = params.sourceExcludes
            .split(',')
            .map((s) => s.trim())
        }
      }

      if (params.trackTotalHits !== undefined) {
        body.track_total_hits = params.trackTotalHits
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        took: data.took,
        timed_out: data.timed_out,
        hits: {
          total: data.hits.total,
          max_score: data.hits.max_score,
          hits: data.hits.hits.map((hit: Record<string, unknown>) => ({
            _index: hit._index,
            _id: hit._id,
            _score: hit._score,
            _source: hit._source,
          })),
        },
      },
    }
  },

  outputs: {
    took: {
      type: 'number',
      description: 'Time in milliseconds the search took',
    },
    timed_out: {
      type: 'boolean',
      description: 'Whether the search timed out',
    },
    hits: {
      type: 'object',
      description: 'Search results with total count and matching documents',
    },
  },
}
