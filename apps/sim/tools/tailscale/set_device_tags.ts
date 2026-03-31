import type { ToolConfig } from '@/tools/types'
import type { TailscaleSetDeviceTagsParams, TailscaleSetDeviceTagsResponse } from './types'

export const tailscaleSetDeviceTagsTool: ToolConfig<
  TailscaleSetDeviceTagsParams,
  TailscaleSetDeviceTagsResponse
> = {
  id: 'tailscale_set_device_tags',
  name: 'Tailscale Set Device Tags',
  description: 'Set tags on a device in the tailnet',
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
    tags: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of tags (e.g., "tag:server,tag:production")',
    },
  },

  request: {
    url: (params) =>
      `https://api.tailscale.com/api/v2/device/${encodeURIComponent(params.deviceId.trim())}/tags`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey.trim()}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      tags: params.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    }),
  },

  transformResponse: async (response: Response, params?: TailscaleSetDeviceTagsParams) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      return {
        success: false,
        output: { success: false, deviceId: '', tags: [] },
        error: (data as Record<string, string>).message ?? 'Failed to set device tags',
      }
    }

    const tags = params?.tags
      ? params.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : []

    return {
      success: true,
      output: {
        success: true,
        deviceId: params?.deviceId ?? '',
        tags,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the tags were successfully set' },
    deviceId: { type: 'string', description: 'Device ID' },
    tags: { type: 'array', description: 'Tags set on the device' },
  },
}
