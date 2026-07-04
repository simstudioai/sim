import type { ToolConfig } from '@/tools/types'
import type { TailscaleDeviceParams, TailscaleGetDeviceResponse } from './types'

export const tailscaleGetDeviceTool: ToolConfig<TailscaleDeviceParams, TailscaleGetDeviceResponse> =
  {
    id: 'tailscale_get_device',
    name: 'Tailscale Get Device',
    description: 'Get details of a specific device by ID',
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
        `https://api.tailscale.com/api/v2/device/${encodeURIComponent(params.deviceId.trim())}`,
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
          output: {
            id: '',
            nodeId: '',
            name: '',
            hostname: '',
            user: '',
            os: '',
            clientVersion: '',
            addresses: [],
            tags: [],
            authorized: false,
            blocksIncomingConnections: false,
            keyExpiryDisabled: false,
            expires: '',
            lastSeen: '',
            created: '',
            isExternal: false,
            updateAvailable: false,
            machineKey: '',
            nodeKey: '',
          },
          error: (data as Record<string, string>).message ?? 'Failed to get device',
        }
      }

      const data = await response.json()
      return {
        success: true,
        output: {
          id: data.id ?? null,
          nodeId: data.nodeId ?? null,
          name: data.name ?? null,
          hostname: data.hostname ?? null,
          user: data.user ?? null,
          os: data.os ?? null,
          clientVersion: data.clientVersion ?? null,
          addresses: data.addresses ?? [],
          tags: data.tags ?? [],
          authorized: data.authorized ?? false,
          blocksIncomingConnections: data.blocksIncomingConnections ?? false,
          keyExpiryDisabled: data.keyExpiryDisabled ?? false,
          expires: data.expires ?? null,
          lastSeen: data.lastSeen ?? null,
          created: data.created ?? null,
          isExternal: data.isExternal ?? false,
          updateAvailable: data.updateAvailable ?? false,
          machineKey: data.machineKey ?? null,
          nodeKey: data.nodeKey ?? null,
        },
      }
    },

    outputs: {
      id: { type: 'string', description: 'Legacy device ID' },
      nodeId: { type: 'string', description: 'Preferred device ID', optional: true },
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
      keyExpiryDisabled: {
        type: 'boolean',
        description: 'Whether the device key is exempt from expiring',
        optional: true,
      },
      expires: {
        type: 'string',
        description: "The device's auth key expiration timestamp",
        optional: true,
      },
      lastSeen: { type: 'string', description: 'Last seen timestamp' },
      created: { type: 'string', description: 'Creation timestamp' },
      isExternal: {
        type: 'boolean',
        description: 'Whether the device is external',
        optional: true,
      },
      updateAvailable: {
        type: 'boolean',
        description: 'Whether an update is available',
        optional: true,
      },
      machineKey: { type: 'string', description: 'Machine key', optional: true },
      nodeKey: { type: 'string', description: 'Node key', optional: true },
    },
  }
