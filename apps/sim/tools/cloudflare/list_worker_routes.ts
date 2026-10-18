import { RESULT_INFO_OUTPUTS, WORKER_ROUTE_OUTPUTS } from '@/tools/cloudflare/outputs'
import type {
  CloudflareListWorkerRoutesParams,
  CloudflareListWorkerRoutesResponse,
} from '@/tools/cloudflare/types'
import {
  cloudflareErrorMessage,
  cloudflareHeaders,
  mapCloudflareFields,
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
    const data = await readCloudflareResponse(response)
    const raw = data.result
    const rows = Array.isArray(raw) ? raw : []
    const success = response.ok && data.success === true && Array.isArray(raw)
    return {
      success,
      output: {
        routes: rows.map((row) => mapCloudflareFields(row, WORKER_ROUTE_OUTPUTS)),
        total_count: data.result_info?.total_count ?? rows.length,
        result_info: data.result_info ?? null,
      },
      ...(!success ? { error: cloudflareErrorMessage(data, 'Failed to list worker routes') } : {}),
    }
  },
  outputs: {
    routes: {
      type: 'array',
      description: 'Routes',
      items: { type: 'object', properties: WORKER_ROUTE_OUTPUTS },
    },
    total_count: {
      type: 'number',
      description:
        'Total matching resources, or the number of resources returned on this page when the API omits a total',
    },
    result_info: {
      type: 'json',
      description: 'Pagination metadata returned by Cloudflare',
      nullable: true,
      properties: RESULT_INFO_OUTPUTS,
    },
  },
}
