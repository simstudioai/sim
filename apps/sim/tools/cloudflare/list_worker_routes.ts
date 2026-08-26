import type {
  CloudflareListWorkerRoutesParams,
  CloudflareListWorkerRoutesResponse,
  CloudflareRawWorkerRoute,
} from '@/tools/cloudflare/types'
import {
  cloudflareErrorMessage,
  cloudflareHeaders,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const listWorkerRoutesTool: ToolConfig<
  CloudflareListWorkerRoutesParams,
  CloudflareListWorkerRoutesResponse
> = {
  id: 'cloudflare_list_worker_routes',
  name: 'Cloudflare List Worker Routes',
  description:
    'Lists the Workers routes on a zone, showing which URL patterns are handled by which Worker script. Unlike the Workers script endpoints, routes are zone-scoped. Requires an API token with Zone Workers Routes Read.',
  version: '1.0.0',

  params: {
    zoneId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The zone ID to list Workers routes for. Routes are zone-scoped, not account-scoped',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Cloudflare API Token',
    },
  },

  request: {
    url: (params) =>
      `https://api.cloudflare.com/client/v4/zones/${safeUrlPathSegment(params.zoneId, 'zoneId')}/workers/routes`,
    method: 'GET',
    headers: (params) => cloudflareHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await readCloudflareResponse<CloudflareRawWorkerRoute[]>(response)

    if (!data.success) {
      return {
        success: false,
        output: { routes: [], total_count: 0 },
        error: cloudflareErrorMessage(data, 'Failed to list Worker routes'),
      }
    }

    const routes = Array.isArray(data.result) ? data.result : []

    return {
      success: true,
      output: {
        routes: routes.map((route) => ({
          id: route.id ?? '',
          pattern: route.pattern ?? '',
          script: route.script ?? null,
        })),
        total_count: routes.length,
      },
    }
  },

  outputs: {
    routes: {
      type: 'array',
      description: 'Workers routes on the zone',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Route identifier' },
          pattern: {
            type: 'string',
            description: 'URL pattern the route matches, e.g. example.com/*',
          },
          script: {
            type: 'string',
            description: 'Name of the Workers script handling the route',
            optional: true,
          },
        },
      },
    },
    total_count: { type: 'number', description: 'Number of routes returned' },
  },
}
