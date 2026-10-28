import { isRecordLike } from '@sim/utils/object'
import { ZONE_OUTPUTS } from '@/tools/cloudflare/outputs'
import type { CloudflareGetZoneParams, CloudflareGetZoneResponse } from '@/tools/cloudflare/types'
import {
  cloudflareErrorMessage,
  mapCloudflareFields,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const getZoneTool: ToolConfig<CloudflareGetZoneParams, CloudflareGetZoneResponse> = {
  id: 'cloudflare_get_zone',
  name: 'Cloudflare Get Zone',
  description: 'Gets details for a specific zone (domain) by its ID.',
  version: '1.0.0',

  params: {
    zoneId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The zone ID to retrieve details for',
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
      `https://api.cloudflare.com/client/v4/zones/${safeUrlPathSegment(params.zoneId, 'zoneId')}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await readCloudflareResponse(response)
    const success = response.ok && data.success === true && isRecordLike(data.result)
    return {
      success,
      output: mapCloudflareFields(data.result, ZONE_OUTPUTS),
      ...(!success ? { error: cloudflareErrorMessage(data, 'Failed to get zone') } : {}),
    }
  },
  outputs: ZONE_OUTPUTS,
}
