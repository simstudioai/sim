import { isRecordLike } from '@sim/utils/object'
import type {
  CloudflareUpdateZoneParams,
  CloudflareUpdateZoneResponse,
} from '@/tools/cloudflare/operation-types'
import { ZONE_OUTPUTS } from '@/tools/cloudflare/outputs'
import {
  cloudflareErrorMessage,
  cloudflareHeaders,
  mapCloudflareFields,
  parseJsonArrayParam,
  parseJsonObjectParam,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const updateZoneTool: ToolConfig<CloudflareUpdateZoneParams, CloudflareUpdateZoneResponse> =
  {
    id: 'cloudflare_update_zone',
    name: 'Cloudflare Update Zone',
    description: 'Edits a zone. Only one zone property can be changed at a time.',
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
      paused: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Indicates whether the zone is only using Cloudflare DNS services. A true value means the zone will not receive security or performance benefits.',
      },
      plan: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description:
          "JSON object. (Deprecated) Please use the `/zones/{zone_id}/subscription` API to update a zone's plan. Changing this value will create/cancel associated subscriptions. To view available plans for this zone, see Zone Plans. Fields: id.",
      },
      type: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'A full zone implies that DNS is hosted with Cloudflare. A partial zone is typically a partner-hosted zone or a CNAME setup. This parameter is only available to Enterprise customers or if it has been explicitly enabled on a zone. Allowed values: full, partial, secondary, internal.',
      },
      vanity_name_servers: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description:
          'JSON array. An array of domains used for custom name servers. This is only available for Business and Enterprise plans.',
      },
    },
    request: {
      url: (params) =>
        `https://api.cloudflare.com/client/v4/zones/${safeUrlPathSegment(params.zoneId, 'zoneId')}`,
      method: 'PATCH',
      headers: (params) => ({ ...cloudflareHeaders(params.apiKey) }),
      body: (params) => ({
        paused: params.paused,
        plan: parseJsonObjectParam(params.plan, 'plan'),
        type: params.type,
        vanity_name_servers: parseJsonArrayParam(params.vanity_name_servers, 'vanity_name_servers'),
      }),
    },
    transformResponse: async (response) => {
      const data = await readCloudflareResponse(response)
      const success = response.ok && data.success === true && isRecordLike(data.result)
      return {
        success,
        output: mapCloudflareFields(data.result, ZONE_OUTPUTS),
        ...(!success ? { error: cloudflareErrorMessage(data, 'Failed to update zone') } : {}),
      }
    },
    outputs: ZONE_OUTPUTS,
  }
