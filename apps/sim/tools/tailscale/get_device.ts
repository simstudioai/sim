import { DEVICE_OUTPUT_PROPERTIES } from '@/tools/tailscale/outputs'
import type {
  TailscaleDevice,
  TailscaleGetDeviceParams,
  TailscaleGetDeviceResponse,
} from '@/tools/tailscale/types'
import { assertTailscaleResponse, mapTailscaleDevice } from '@/tools/tailscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const tailscaleGetDeviceTool: ToolConfig<
  TailscaleGetDeviceParams,
  TailscaleGetDeviceResponse
> = {
  id: 'tailscale_get_device',
  name: 'Tailscale Get Device',
  description: 'Get details of a specific device',
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
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Device fields to return: default or all',
    },
  },
  request: {
    url: (params) =>
      `https://api.tailscale.com/api/v2/device/${safeUrlPathSegment(params.deviceId, 'deviceId')}${params.fields ? `?fields=${encodeURIComponent(params.fields)}` : ''}`,
    method: 'GET',
    headers: (params) => ({ Authorization: `Bearer ${params.apiKey.trim()}` }),
  },
  transformResponse: async (response) => {
    await assertTailscaleResponse(response)
    const data: TailscaleDevice = await response.json()
    return { success: true, output: mapTailscaleDevice(data) }
  },
  outputs: DEVICE_OUTPUT_PROPERTIES,
}
