import type { ToolConfig } from '@/tools/types'
import type { TailscaleSetDeviceRoutesParams, TailscaleSetDeviceRoutesResponse } from './types'

export const tailscaleSetDeviceRoutesTool: ToolConfig<
  TailscaleSetDeviceRoutesParams,
  TailscaleSetDeviceRoutesResponse
> = {
  id: 'tailscale_set_device_routes',
  name: 'Tailscale Set Device Routes',
  description: 'Set the enabled subnet routes for a device',
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
    routes: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of subnet routes to enable (e.g., "10.0.0.0/24,192.168.1.0/24")',
    },
  },

  request: {
    url: (params) =>
      `https://api.tailscale.com/api/v2/device/${encodeURIComponent(params.deviceId.trim())}/routes`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey.trim()}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      routes: params.routes
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean),
    }),
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      return {
        success: false,
        output: { advertisedRoutes: [], enabledRoutes: [] },
        error: (data as Record<string, string>).message ?? 'Failed to set device routes',
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
    enabledRoutes: { type: 'array', description: 'Subnet routes that are now enabled' },
  },
}
