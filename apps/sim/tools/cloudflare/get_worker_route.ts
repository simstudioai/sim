import { isRecordLike } from '@sim/utils/object'
import type {
  CloudflareGetWorkerRouteParams,
  CloudflareGetWorkerRouteResponse,
} from '@/tools/cloudflare/operation-types'
import { WORKER_ROUTE_OUTPUTS } from '@/tools/cloudflare/outputs'
import {
  cloudflareErrorMessage,
  cloudflareHeaders,
  mapCloudflareFields,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const getWorkerRouteTool: ToolConfig<
  CloudflareGetWorkerRouteParams,
  CloudflareGetWorkerRouteResponse
> = {
  id: 'cloudflare_get_worker_route',
  name: 'Cloudflare Get Worker Route',
  description: 'Returns information about a Worker route, including URL pattern and Worker.',
  version: '1.0.0',
  params: {
    zoneId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Zone id',
    },
    routeId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Route id',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Cloudflare API token',
    },
  },
  request: {
    url: (params) =>
      `https://api.cloudflare.com/client/v4/zones/${safeUrlPathSegment(params.zoneId, 'zoneId')}/workers/routes/${safeUrlPathSegment(params.routeId, 'routeId')}`,
    method: 'GET',
    headers: (params) => ({ ...cloudflareHeaders(params.apiKey) }),
  },
  transformResponse: async (response) => {
    const data = await readCloudflareResponse(response)
    const success = response.ok && data.success === true && isRecordLike(data.result)
    return {
      success,
      output: mapCloudflareFields(data.result, WORKER_ROUTE_OUTPUTS),
      ...(!success ? { error: cloudflareErrorMessage(data, 'Failed to get worker route') } : {}),
    }
  },
  outputs: WORKER_ROUTE_OUTPUTS,
}
