import type {
  TailscaleSetDeviceRoutesParams,
  TailscaleSetDeviceRoutesResponse,
} from '@/tools/tailscale/types'
import { assertTailscaleResponse, parseTailscaleList } from '@/tools/tailscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const tailscaleSetDeviceRoutesTool: ToolConfig<
  TailscaleSetDeviceRoutesParams,
  TailscaleSetDeviceRoutesResponse
> = {
  id: 'tailscale_set_device_routes',
  name: 'Tailscale Set Device Routes',
  description: 'Replace the enabled subnet routes for a device',
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
    routes: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated enabled CIDR routes; use [] to disable all routes',
    },
  },
  request: {
    url: (params) =>
      `https://api.tailscale.com/api/v2/device/${safeUrlPathSegment(params.deviceId, 'deviceId')}/routes`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey.trim()}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({ routes: parseTailscaleList(params.routes) }),
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
