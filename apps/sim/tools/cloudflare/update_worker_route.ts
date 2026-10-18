import { isRecordLike } from '@sim/utils/object'
import type {
  CloudflareUpdateWorkerRouteParams,
  CloudflareUpdateWorkerRouteResponse,
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

export const updateWorkerRouteTool: ToolConfig<
  CloudflareUpdateWorkerRouteParams,
  CloudflareUpdateWorkerRouteResponse
> = {
  id: 'cloudflare_update_worker_route',
  name: 'Cloudflare Update Worker Route',
  description:
    'Replaces the URL pattern or Worker associated with a Worker route. Replaces the configuration; resend all values to retain.',
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
    pattern: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Pattern to match incoming requests against. [Learn more](https://developers.cloudflare.com/workers/configuration/routing/routes/#matching-behavior).',
    },
    script: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Name of the script to run if the route matches.',
    },
  },
  request: {
    url: (params) =>
      `https://api.cloudflare.com/client/v4/zones/${safeUrlPathSegment(params.zoneId, 'zoneId')}/workers/routes/${safeUrlPathSegment(params.routeId, 'routeId')}`,
    method: 'PUT',
    headers: (params) => ({ ...cloudflareHeaders(params.apiKey) }),
    body: (params) => ({ pattern: params.pattern, script: params.script }),
  },
  transformResponse: async (response) => {
    const data = await readCloudflareResponse(response)
    const success = response.ok && data.success === true && isRecordLike(data.result)
    return {
      success,
      output: mapCloudflareFields(data.result, WORKER_ROUTE_OUTPUTS),
      ...(!success ? { error: cloudflareErrorMessage(data, 'Failed to update worker route') } : {}),
    }
  },
  outputs: WORKER_ROUTE_OUTPUTS,
}
