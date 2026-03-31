import type { ToolConfig } from '@/tools/types'
import type { TailscaleAuthorizeDeviceParams, TailscaleAuthorizeDeviceResponse } from './types'

export const tailscaleAuthorizeDeviceTool: ToolConfig<
  TailscaleAuthorizeDeviceParams,
  TailscaleAuthorizeDeviceResponse
> = {
  id: 'tailscale_authorize_device',
  name: 'Tailscale Authorize Device',
  description: 'Authorize or deauthorize a device on the tailnet',
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
      description: 'Device ID to authorize',
    },
    authorized: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description: 'Whether to authorize (true) or deauthorize (false) the device',
    },
  },

  request: {
    url: (params) =>
      `https://api.tailscale.com/api/v2/device/${encodeURIComponent(params.deviceId.trim())}/authorized`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey.trim()}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      authorized: params.authorized,
    }),
  },

  transformResponse: async (response: Response, params?: TailscaleAuthorizeDeviceParams) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      return {
        success: false,
        output: { success: false, deviceId: '', authorized: false },
        error: (data as Record<string, string>).message ?? 'Failed to authorize device',
      }
    }

    return {
      success: true,
      output: {
        success: true,
        deviceId: params?.deviceId ?? '',
        authorized: params?.authorized ?? true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the operation succeeded' },
    deviceId: { type: 'string', description: 'Device ID' },
    authorized: { type: 'boolean', description: 'Authorization status after the operation' },
  },
}
