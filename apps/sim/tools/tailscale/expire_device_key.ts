import type { ToolConfig } from '@/tools/types'
import type { TailscaleDeviceParams } from './types'

interface TailscaleExpireDeviceKeyResponse {
  success: boolean
  output: {
    success: boolean
    deviceId: string
  }
  error?: string
}

export const tailscaleExpireDeviceKeyTool: ToolConfig<
  TailscaleDeviceParams,
  TailscaleExpireDeviceKeyResponse
> = {
  id: 'tailscale_expire_device_key',
  name: 'Tailscale Expire Device Key',
  description:
    "Immediately expire a device's node key, requiring it to re-authenticate before it can reconnect to the tailnet",
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
      description: 'Device ID to expire the key for',
    },
  },

  request: {
    url: (params) =>
      `https://api.tailscale.com/api/v2/device/${encodeURIComponent(params.deviceId.trim())}/expire`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey.trim()}`,
    }),
  },

  transformResponse: async (response: Response, params?: TailscaleDeviceParams) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      return {
        success: false,
        output: { success: false, deviceId: '' },
        error: (data as Record<string, string>).message ?? 'Failed to expire device key',
      }
    }

    return {
      success: true,
      output: {
        success: true,
        deviceId: params?.deviceId ?? '',
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: "Whether the device's key was successfully expired" },
    deviceId: { type: 'string', description: 'Device ID' },
  },
}
