import type {
  ElasticsearchCreateIndexParams,
  ElasticsearchIndexResponse,
} from '@/tools/elasticsearch/types'
import type { ToolConfig } from '@/tools/types'

function buildBaseUrl(params: ElasticsearchCreateIndexParams): string {
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

function buildAuthHeaders(params: ElasticsearchCreateIndexParams): Record<string, string> {
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

export const createIndexTool: ToolConfig<
  ElasticsearchCreateIndexParams,
  ElasticsearchIndexResponse
> = {
  id: 'elasticsearch_create_index',
  name: 'Elasticsearch Create Index',
  description: 'Create a new index with optional settings and mappings.',
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
      description: 'Index name to create (e.g., "products", "logs-2024")',
    },
    settings: {
      type: 'string',
      required: false,
      description: 'Index settings as JSON string',
    },
    mappings: {
      type: 'string',
      required: false,
      description: 'Index mappings as JSON string',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = buildBaseUrl(params)
      return `${baseUrl}/${encodeURIComponent(params.index)}`
    },
    method: 'PUT',
    headers: (params) => buildAuthHeaders(params),
    body: (params) => {
      const body: Record<string, unknown> = {}

      if (params.settings) {
        try {
          body.settings = JSON.parse(params.settings)
        } catch {
          // Ignore invalid settings
        }
      }

      if (params.mappings) {
        try {
          body.mappings = JSON.parse(params.mappings)
        } catch {
          // Ignore invalid mappings
        }
      }

      return body
    },
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
        output: { acknowledged: false },
        error: errorMessage,
      }
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        acknowledged: data.acknowledged,
        shards_acknowledged: data.shards_acknowledged,
        index: data.index,
      },
    }
  },

  outputs: {
    acknowledged: {
      type: 'boolean',
      description: 'Whether the request was acknowledged',
    },
    shards_acknowledged: {
      type: 'boolean',
      description: 'Whether the shards were acknowledged',
    },
    index: {
      type: 'string',
      description: 'Created index name',
    },
  },
}
