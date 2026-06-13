import { resolveCrwBaseUrl } from '@/tools/crw/base-url'
import type { MapParams, MapResponse } from '@/tools/crw/types'
import type { ToolConfig } from '@/tools/types'

export const mapTool: ToolConfig<MapParams, MapResponse> = {
  id: 'crw_map',
  name: 'fastCRW Map',
  description:
    'Get a complete list of URLs from any website quickly and reliably. Useful for discovering all pages on a site without crawling them.',
  version: '1.0.0',

  params: {
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The base URL to map and discover links from (e.g., "https://example.com")',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of links to return (e.g., 100, 1000, 5000)',
    },
    baseUrl: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Base URL for self-hosted fastCRW (defaults to https://fastcrw.com/api)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'fastCRW API key',
    },
  },

  hosting: {
    envKeyPrefix: 'CRW_API_KEY',
    apiKeyParam: 'apiKey',
    byokProviderId: 'crw',
    // fastCRW is BYOK-only — Sim does not meter usage.
    pricing: { type: 'per_request', cost: 0 },
    rateLimit: {
      mode: 'per_request',
      requestsPerMinute: 100,
    },
  },

  request: {
    method: 'POST',
    url: (params) => `${resolveCrwBaseUrl(params.baseUrl)}/v1/map`,
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const body: Record<string, any> = {
        url: params.url,
      }

      if (params.limit) body.limit = Number(params.limit)

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: data.success,
      output: {
        success: data.success,
        links: data.links || [],
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the mapping operation was successful',
    },
    links: {
      type: 'array',
      description: 'Array of discovered URLs from the website',
      items: {
        type: 'string',
      },
    },
  },
}
