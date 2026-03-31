import type { ToolConfig } from '@/tools/types'
import type { TailscaleDeviceParams, TailscaleGetDeviceRoutesResponse } from './types'

export const tailscaleGetDeviceRoutesTool: ToolConfig<
  TailscaleDeviceParams,
  TailscaleGetDeviceRoutesResponse
> = {
  id: 'tailscale_get_device_routes',
  name: 'Tailscale Get Device Routes',
  description: 'Get the subnet routes for a device',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Tailscale API key',
    },
    tailnet: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Tailnet name (e.g., example.com) or "-" for default',
    },
    deviceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Device ID',
    },
  },

  request: {
    url: (params) =>
      `https://api.tailscale.com/api/v2/device/${encodeURIComponent(params.deviceId.trim())}/routes`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey.trim()}`,
    }),
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      return {
        success: false,
        output: { advertisedRoutes: [], enabledRoutes: [] },
        error: (data as Record<string, string>).message ?? 'Failed to get device routes',
      }
    }

    const data = await response.json()
    return {
      success: true,
      output: {
        advertisedRoutes: data.advertisedRoutes ?? [],
        enabledRoutes: data.enabledRoutes ?? [],
      },
    }
  },

  outputs: {
    advertisedRoutes: { type: 'array', description: 'Subnet routes the device is advertising' },
    enabledRoutes: { type: 'array', description: 'Subnet routes that are approved/enabled' },
  },
}
