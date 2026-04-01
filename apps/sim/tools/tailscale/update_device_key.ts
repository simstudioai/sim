import type { ToolConfig } from '@/tools/types'
import type { TailscaleUpdateDeviceKeyParams, TailscaleUpdateDeviceKeyResponse } from './types'

export const tailscaleUpdateDeviceKeyTool: ToolConfig<
  TailscaleUpdateDeviceKeyParams,
  TailscaleUpdateDeviceKeyResponse
> = {
  id: 'tailscale_update_device_key',
  name: 'Tailscale Update Device Key',
  description: 'Enable or disable key expiry on a device',
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
    keyExpiryDisabled: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description: 'Whether to disable key expiry (true) or enable it (false)',
    },
  },

  request: {
    url: (params) =>
      `https://api.tailscale.com/api/v2/device/${encodeURIComponent(params.deviceId.trim())}/key`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey.trim()}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      keyExpiryDisabled: params.keyExpiryDisabled,
    }),
  },

  transformResponse: async (response: Response, params?: TailscaleUpdateDeviceKeyParams) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      return {
        success: false,
        output: { success: false, deviceId: '', keyExpiryDisabled: false },
        error: (data as Record<string, string>).message ?? 'Failed to update device key',
      }
    }

    return {
      success: true,
      output: {
        success: true,
        deviceId: params?.deviceId ?? '',
        keyExpiryDisabled: params?.keyExpiryDisabled ?? true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the operation succeeded' },
    deviceId: { type: 'string', description: 'Device ID' },
    keyExpiryDisabled: { type: 'boolean', description: 'Whether key expiry is now disabled' },
  },
}
