import type { ToolConfig } from '@/tools/types'
import type { TailscaleBaseParams, TailscaleListDevicesResponse } from './types'

export const tailscaleListDevicesTool: ToolConfig<
  TailscaleBaseParams,
  TailscaleListDevicesResponse
> = {
  id: 'tailscale_list_devices',
  name: 'Tailscale List Devices',
  description: 'List all devices in the tailnet',
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
  },

  request: {
    url: (params) =>
      `https://api.tailscale.com/api/v2/tailnet/${encodeURIComponent(params.tailnet.trim())}/devices`,
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
        output: { devices: [], count: 0 },
        error: (data as Record<string, string>).message ?? 'Failed to list devices',
      }
    }

    const data = await response.json()
    const devices = (data.devices ?? []).map((device: Record<string, unknown>) => ({
      id: (device.id as string) ?? null,
      name: (device.name as string) ?? null,
      hostname: (device.hostname as string) ?? null,
      user: (device.user as string) ?? null,
      os: (device.os as string) ?? null,
      clientVersion: (device.clientVersion as string) ?? null,
      addresses: (device.addresses as string[]) ?? [],
      tags: (device.tags as string[]) ?? [],
      authorized: (device.authorized as boolean) ?? false,
      blocksIncomingConnections: (device.blocksIncomingConnections as boolean) ?? false,
      lastSeen: (device.lastSeen as string) ?? null,
      created: (device.created as string) ?? null,
    }))

    return {
      success: true,
      output: {
        devices,
        count: devices.length,
      },
    }
  },

  outputs: {
    devices: {
      type: 'array',
      description: 'List of devices in the tailnet',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Device ID' },
          name: { type: 'string', description: 'Device name' },
          hostname: { type: 'string', description: 'Device hostname' },
          user: { type: 'string', description: 'Associated user' },
          os: { type: 'string', description: 'Operating system' },
          clientVersion: { type: 'string', description: 'Tailscale client version' },
          addresses: { type: 'array', description: 'Tailscale IP addresses' },
          tags: { type: 'array', description: 'Device tags' },
          authorized: { type: 'boolean', description: 'Whether the device is authorized' },
          blocksIncomingConnections: {
            type: 'boolean',
            description: 'Whether the device blocks incoming connections',
          },
          lastSeen: { type: 'string', description: 'Last seen timestamp' },
          created: { type: 'string', description: 'Creation timestamp' },
        },
      },
    },
    count: {
      type: 'number',
      description: 'Total number of devices',
    },
  },
}
