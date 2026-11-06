import { isRecordLike } from '@sim/utils/object'
import type {
  CloudflareCreateWorkerRouteParams,
  CloudflareCreateWorkerRouteResponse,
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

export const createWorkerRouteTool: ToolConfig<
  CloudflareCreateWorkerRouteParams,
  CloudflareCreateWorkerRouteResponse
> = {
  id: 'cloudflare_create_worker_route',
  name: 'Cloudflare Create Worker Route',
  description: 'Creates a route that maps a URL pattern to a Worker.',
  version: '1.0.0',
  params: {
    zoneId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Zone id',
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
      `https://api.cloudflare.com/client/v4/zones/${safeUrlPathSegment(params.zoneId, 'zoneId')}/workers/routes`,
    method: 'POST',
    headers: (params) => ({ ...cloudflareHeaders(params.apiKey) }),
    body: (params) => ({ pattern: params.pattern, script: params.script }),
  },
  transformResponse: async (response) => {
    const data = await readCloudflareResponse(response)
    const success = response.ok && data.success === true && isRecordLike(data.result)
    return {
      success,
      output: mapCloudflareFields(data.result, WORKER_ROUTE_OUTPUTS),
      ...(!success ? { error: cloudflareErrorMessage(data, 'Failed to create worker route') } : {}),
    }
  },
  outputs: WORKER_ROUTE_OUTPUTS,
}
