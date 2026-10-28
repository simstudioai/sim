import type {
  TailscaleAuthorizeDeviceParams,
  TailscaleAuthorizeDeviceResponse,
} from '@/tools/tailscale/types'
import { assertTailscaleResponse } from '@/tools/tailscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

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
      description:
        'Tailscale API access token or OAuth access token (not an auth key or OAuth client secret)',
    },
    deviceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Device nodeId (preferred) or legacy device ID',
    },
    authorized: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description: 'Whether to authorize or deauthorize the device',
    },
  },
  request: {
    url: (params) =>
      `https://api.tailscale.com/api/v2/device/${safeUrlPathSegment(params.deviceId, 'deviceId')}/authorized`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey.trim()}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({ authorized: params.authorized }),
  },
  transformResponse: async (response, params) => {
    await assertTailscaleResponse(response)
    return {
      success: true,
      output: {
        success: true,
        deviceId: params?.deviceId ?? '',
        authorized: params?.authorized ?? false,
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
    authorized: {
      type: 'boolean',
      description: 'Requested device authorization state',
    },
  },
}
