import type {
  ElasticsearchListIndicesParams,
  ElasticsearchListIndicesResponse,
} from '@/tools/elasticsearch/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Builds the base URL for Elasticsearch connections.
 * Supports both self-hosted and Elastic Cloud deployments.
 */
function buildBaseUrl(params: ElasticsearchListIndicesParams): string {
  if (params.deploymentType === 'cloud' && params.cloudId) {
    const parts = params.cloudId.split(':')
    if (parts.length >= 2) {
      try {
        const decoded = Buffer.from(parts[1], 'base64').toString('utf-8')
        const [esHost] = decoded.split('$')
        if (esHost) {
          return `https://${parts[0]}.${esHost}`
        }
      } catch {
        // Fallback
      }
    }
    throw new Error('Invalid Cloud ID format')
  }

  if (!params.host) {
    throw new Error('Host is required for self-hosted deployments')
  }

  return params.host.replace(/\/$/, '')
}

/**
 * Builds authentication headers for Elasticsearch requests.
 * Supports API key and basic authentication methods.
 */
function buildAuthHeaders(params: ElasticsearchListIndicesParams): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (params.authMethod === 'api_key' && params.apiKey) {
    headers.Authorization = `ApiKey ${params.apiKey}`
  } else if (params.authMethod === 'basic_auth' && params.username && params.password) {
    const credentials = Buffer.from(`${params.username}:${params.password}`).toString('base64')
    headers.Authorization = `Basic ${credentials}`
  } else {
    throw new Error('Invalid authentication configuration')
  }

  return headers
}

export const listIndicesTool: ToolConfig<
  ElasticsearchListIndicesParams,
  ElasticsearchListIndicesResponse
> = {
  id: 'elasticsearch_list_indices',
  name: 'Elasticsearch List Indices',
  description:
    'List all indices in the Elasticsearch cluster with their health, status, and statistics.',
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
    if (!response.ok) {
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
        output: {
          message: errorMessage,
          indices: [],
        },
        error: errorMessage,
      }
    }

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
