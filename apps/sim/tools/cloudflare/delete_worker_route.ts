import { isRecordLike } from '@sim/utils/object'
import type {
  CloudflareDeleteWorkerRouteParams,
  CloudflareDeleteWorkerRouteResponse,
} from '@/tools/cloudflare/operation-types'
import {
  cloudflareErrorMessage,
  cloudflareHeaders,
  mapCloudflareFields,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const deleteWorkerRouteTool: ToolConfig<
  CloudflareDeleteWorkerRouteParams,
  CloudflareDeleteWorkerRouteResponse
> = {
  id: 'cloudflare_delete_worker_route',
  name: 'Cloudflare Delete Worker Route',
  description: 'Deletes a Worker route.',
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
    method: 'DELETE',
    headers: (params) => ({ ...cloudflareHeaders(params.apiKey) }),
  },
  transformResponse: async (response) => {
    const data = await readCloudflareResponse(response)
    const success = response.ok && data.success === true && isRecordLike(data.result)
    return {
      success,
      output: mapCloudflareFields(data.result, {
        id: { type: 'string', nullable: true, description: 'Identifier.' },
      } as const),
      ...(!success ? { error: cloudflareErrorMessage(data, 'Failed to delete worker route') } : {}),
    }
  },
  outputs: { id: { type: 'string', nullable: true, description: 'Identifier.' } },
}
