import type {
  TailscaleDeviceParams,
  TailscaleGetDeviceRoutesResponse,
} from '@/tools/tailscale/types'
import { assertTailscaleResponse } from '@/tools/tailscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const tailscaleGetDeviceRoutesTool: ToolConfig<
  TailscaleDeviceParams,
  TailscaleGetDeviceRoutesResponse
> = {
  id: 'tailscale_get_device_routes',
  name: 'Tailscale Get Device Routes',
  description: 'Get the advertised and approved subnet routes for a device',
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
  },
  request: {
    url: (params) =>
      `https://api.tailscale.com/api/v2/device/${safeUrlPathSegment(params.deviceId, 'deviceId')}/routes`,
    method: 'GET',
    headers: (params) => ({ Authorization: `Bearer ${params.apiKey.trim()}` }),
  },
  transformResponse: async (response) => {
    await assertTailscaleResponse(response)
    const data: { advertisedRoutes: string[]; enabledRoutes: string[] } = await response.json()
    return {
      success: true,
      output: {
        advertisedRoutes: data.advertisedRoutes ?? [],
        enabledRoutes: data.enabledRoutes ?? [],
      },
    }
  },
  outputs: {
    advertisedRoutes: {
      type: 'array',
      description: 'Subnet CIDR routes advertised by the device',
      items: {
        type: 'string',
      },
    },
    enabledRoutes: {
      type: 'array',
      description: 'Approved subnet CIDR routes',
      items: {
        type: 'string',
      },
    },
  },
}
