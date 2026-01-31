import type {
  ElasticsearchBulkParams,
  ElasticsearchBulkResponse,
} from '@/tools/elasticsearch/types'
import type { ToolConfig } from '@/tools/types'

function buildBaseUrl(params: ElasticsearchBulkParams): string {
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

function buildAuthHeaders(params: ElasticsearchBulkParams): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-ndjson',
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

export const bulkTool: ToolConfig<ElasticsearchBulkParams, ElasticsearchBulkResponse> = {
  id: 'elasticsearch_bulk',
  name: 'Elasticsearch Bulk Operations',
  description:
    'Perform multiple index, create, delete, or update operations in a single request for high performance.',
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
      required: false,
      visibility: 'user-or-llm',
      description: 'Default index for operations (e.g., "products", "logs-2024")',
    },
    operations: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Bulk operations as NDJSON string. Each operation is two lines: action metadata and optional document. Example: {"index":{"_index":"products","_id":"1"}}\\n{"name":"Widget"}\\n',
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
      let url = params.index
        ? `${baseUrl}/${encodeURIComponent(params.index)}/_bulk`
        : `${baseUrl}/_bulk`

      if (params.refresh) {
        url += `?refresh=${params.refresh}`
      }

      return url
    },
    method: 'POST',
    headers: (params) => buildAuthHeaders(params),
    body: (params) => {
      // The body should be NDJSON format - we pass it as raw string
      // Ensure it ends with a newline
      // Note: The executor in tools/utils.ts handles NDJSON content-type specially
      // and accepts string bodies directly
      let operations = params.operations.trim()
      if (!operations.endsWith('\n')) {
        operations += '\n'
      }
      return operations as unknown as Record<string, any>
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
        output: { took: 0, errors: true, items: [] },
        error: errorMessage,
      }
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        took: data.took,
        errors: data.errors,
        items: data.items,
      },
    }
  },

  outputs: {
    took: {
      type: 'number',
      description: 'Time in milliseconds the bulk operation took',
    },
    errors: {
      type: 'boolean',
      description: 'Whether any operation had an error',
    },
    items: {
      type: 'array',
      description: 'Results for each operation',
    },
  },
}
