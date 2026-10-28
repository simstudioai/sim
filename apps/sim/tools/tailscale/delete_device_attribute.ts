import type {
  TailscaleDeleteDeviceAttributeResponse,
  TailscaleDeviceAttributeParams,
} from '@/tools/tailscale/types'
import { assertTailscaleResponse } from '@/tools/tailscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const tailscaleDeleteDeviceAttributeTool: ToolConfig<
  TailscaleDeviceAttributeParams,
  TailscaleDeleteDeviceAttributeResponse
> = {
  id: 'tailscale_delete_device_attribute',
  name: 'Tailscale Delete Device Attribute',
  description: 'Remove a custom posture attribute from a device',
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
    attributeKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Custom posture attribute name, prefixed with custom:',
    },
  },
  request: {
    url: (params) =>
      `https://api.tailscale.com/api/v2/device/${safeUrlPathSegment(params.deviceId, 'deviceId')}/attributes/${safeUrlPathSegment(params.attributeKey, 'attributeKey')}`,
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey.trim()}`,
      'Content-Type': 'application/json',
    }),
  },
  transformResponse: async (response, params) => {
    await assertTailscaleResponse(response)
    return {
      success: true,
      output: {
        success: true,
        deviceId: params?.deviceId ?? '',
        attributeKey: params?.attributeKey ?? '',
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
    attributeKey: {
      type: 'string',
      description: 'Deleted custom posture attribute key',
    },
  },
}
