import type { TailscaleDeleteDeviceResponse, TailscaleDeviceParams } from '@/tools/tailscale/types'
import { assertTailscaleResponse } from '@/tools/tailscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

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
      description:
        'Tailscale API access token or OAuth access token (not an auth key or OAuth client secret)',
    },
    deviceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Device nodeId (preferred) or legacy device ID',
    },
  },
  request: {
    url: (params) =>
      `https://api.tailscale.com/api/v2/device/${safeUrlPathSegment(params.deviceId, 'deviceId')}`,
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey.trim()}`,
      'Content-Type': 'application/json',
    }),
  },
  transformResponse: async (response, params) => {
    await assertTailscaleResponse(response)
    return { success: true, output: { success: true, deviceId: params?.deviceId ?? '' } }
  },
  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the operation succeeded',
    },
    deviceId: {
      type: 'string',
      description: 'ID of the affected device',
    },
  },
}
