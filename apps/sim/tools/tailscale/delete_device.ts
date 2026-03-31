import type { ToolConfig } from '@/tools/types'
import type { TailscaleDeleteDeviceResponse, TailscaleDeviceParams } from './types'

export const tailscaleDeleteDeviceTool: ToolConfig<
  TailscaleDeviceParams,
  TailscaleDeleteDeviceResponse
> = {
  id: 'tailscale_delete_device',
  name: 'Tailscale Delete Device',
  description: 'Remove a device from the tailnet',
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
      description: 'Device ID to delete',
    },
  },

  request: {
    url: (params) =>
      `https://api.tailscale.com/api/v2/device/${encodeURIComponent(params.deviceId.trim())}`,
    method: 'DELETE',
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
        error: (data as Record<string, string>).message ?? 'Failed to delete device',
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
    success: { type: 'boolean', description: 'Whether the device was successfully deleted' },
    deviceId: { type: 'string', description: 'ID of the deleted device' },
  },
}
