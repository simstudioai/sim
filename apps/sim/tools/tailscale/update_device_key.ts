import type {
  TailscaleUpdateDeviceKeyParams,
  TailscaleUpdateDeviceKeyResponse,
} from '@/tools/tailscale/types'
import { assertTailscaleResponse } from '@/tools/tailscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const tailscaleUpdateDeviceKeyTool: ToolConfig<
  TailscaleUpdateDeviceKeyParams,
  TailscaleUpdateDeviceKeyResponse
> = {
  id: 'tailscale_update_device_key',
  name: 'Tailscale Update Device Key',
  description: 'Enable or disable device key expiry',
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
    keyExpiryDisabled: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description: 'Whether to disable device key expiry',
    },
  },
  request: {
    url: (params) =>
      `https://api.tailscale.com/api/v2/device/${safeUrlPathSegment(params.deviceId, 'deviceId')}/key`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey.trim()}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({ keyExpiryDisabled: params.keyExpiryDisabled }),
  },
  transformResponse: async (response, params) => {
    await assertTailscaleResponse(response)
    return {
      success: true,
      output: {
        success: true,
        deviceId: params?.deviceId ?? '',
        keyExpiryDisabled: params?.keyExpiryDisabled ?? false,
      },
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
    keyExpiryDisabled: {
      type: 'boolean',
      description: 'Requested device key expiry setting',
    },
  },
}
