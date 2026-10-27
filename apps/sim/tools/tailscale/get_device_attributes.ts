import type {
  TailscaleDeviceParams,
  TailscaleGetDeviceAttributesResponse,
} from '@/tools/tailscale/types'
import { assertTailscaleResponse } from '@/tools/tailscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const tailscaleGetDeviceAttributesTool: ToolConfig<
  TailscaleDeviceParams,
  TailscaleGetDeviceAttributesResponse
> = {
  id: 'tailscale_get_device_attributes',
  name: 'Tailscale Get Device Attributes',
  description: 'Get device posture attributes and their expiry times',
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
      `https://api.tailscale.com/api/v2/device/${safeUrlPathSegment(params.deviceId, 'deviceId')}/attributes`,
    method: 'GET',
    headers: (params) => ({ Authorization: `Bearer ${params.apiKey.trim()}` }),
  },
  transformResponse: async (response) => {
    await assertTailscaleResponse(response)
    const data: {
      attributes: Record<string, string | number | boolean>
      expiries: Record<string, string>
    } = await response.json()
    return {
      success: true,
      output: { attributes: data.attributes ?? {}, expiries: data.expiries ?? {} },
    }
  },
  outputs: {
    attributes: {
      type: 'json',
      description: 'Map of posture attribute names to string, number, or boolean values',
    },
    expiries: {
      type: 'json',
      description: 'Map of posture attribute names to RFC 3339 expiry timestamps',
    },
  },
}
