import type {
  TailscaleSetDeviceTagsParams,
  TailscaleSetDeviceTagsResponse,
} from '@/tools/tailscale/types'
import { assertTailscaleResponse, parseTailscaleList } from '@/tools/tailscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const tailscaleSetDeviceTagsTool: ToolConfig<
  TailscaleSetDeviceTagsParams,
  TailscaleSetDeviceTagsResponse
> = {
  id: 'tailscale_set_device_tags',
  name: 'Tailscale Set Device Tags',
  description: 'Replace the tags assigned to a device',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'Tailscale API access token or OAuth access token (not an auth key or OAuth client secret)',
    },
    deviceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Device nodeId (preferred) or legacy device ID',
    },
    tags: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated device tags; use [] to clear tags',
    },
  },
  request: {
    url: (params) =>
      `https://api.tailscale.com/api/v2/device/${safeUrlPathSegment(params.deviceId, 'deviceId')}/tags`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey.trim()}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({ tags: parseTailscaleList(params.tags) }),
  },
  transformResponse: async (response, params) => {
    await assertTailscaleResponse(response)
    return {
      success: true,
      output: {
        success: true,
        deviceId: params?.deviceId ?? '',
        tags: params?.tags ? parseTailscaleList(params.tags) : [],
      },
    }
  },
  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the operation succeeded',
    },
    deviceId: {
      type: 'string',
      description: 'ID of the affected device',
    },
    tags: {
      type: 'array',
      description: 'Tags submitted for the device',
      items: {
        type: 'string',
      },
    },
  },
}
