import { isRecordLike } from '@sim/utils/object'
import { ZONE_OUTPUTS } from '@/tools/cloudflare/outputs'
import type {
  CloudflareCreateZoneParams,
  CloudflareCreateZoneResponse,
} from '@/tools/cloudflare/types'
import {
  cloudflareErrorMessage,
  mapCloudflareFields,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'

export const createZoneTool: ToolConfig<CloudflareCreateZoneParams, CloudflareCreateZoneResponse> =
  {
    id: 'cloudflare_create_zone',
    name: 'Cloudflare Create Zone',
    description: 'Adds a new zone (domain) to the Cloudflare account.',
    version: '1.0.0',

    params: {
      name: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The domain name to add (e.g., "example.com")',
      },
      accountId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The Cloudflare account ID',
      },
      type: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Zone type: "full" (Cloudflare manages DNS), "partial" (CNAME setup), "secondary" (secondary DNS), or "internal" (internal DNS zone)',
      },
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Cloudflare API Token',
      },
    },

    request: {
      url: 'https://api.cloudflare.com/client/v4/zones',
      method: 'POST',
      headers: (params) => ({
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      }),
      body: (params) => {
        const body: Record<string, unknown> = {
          name: params.name,
          account: { id: params.accountId.trim() },
        }
        if (params.type) body.type = params.type
        return body
      },
    },

    transformResponse: async (response: Response) => {
      const data = await readCloudflareResponse(response)
      const success = response.ok && data.success === true && isRecordLike(data.result)
      return {
        success,
        output: mapCloudflareFields(data.result, ZONE_OUTPUTS),
        ...(!success ? { error: cloudflareErrorMessage(data, 'Failed to create zone') } : {}),
      }
    },
    outputs: ZONE_OUTPUTS,
  }
