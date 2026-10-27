import type {
  TailscaleSetDeviceNameParams,
  TailscaleSetDeviceNameResponse,
} from '@/tools/tailscale/types'
import { assertTailscaleResponse } from '@/tools/tailscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const tailscaleSetDeviceNameTool: ToolConfig<
  TailscaleSetDeviceNameParams,
  TailscaleSetDeviceNameResponse
> = {
  id: 'tailscale_set_device_name',
  name: 'Tailscale Set Device Name',
  description: 'Rename a device or reset its name to the OS hostname',
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
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New device name or FQDN; empty resets it to the OS hostname',
    },
  },
  request: {
    url: (params) =>
      `https://api.tailscale.com/api/v2/device/${safeUrlPathSegment(params.deviceId, 'deviceId')}/name`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey.trim()}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({ name: params.name?.trim() ?? '' }),
  },
  transformResponse: async (response, params) => {
    await assertTailscaleResponse(response)
    return {
      success: true,
      output: { success: true, deviceId: params?.deviceId ?? '', name: params?.name?.trim() ?? '' },
    }
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
    name: {
      type: 'string',
      description: 'Submitted device name; empty resets the name',
    },
  },
}
