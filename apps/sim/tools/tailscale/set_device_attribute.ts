import type {
  TailscaleSetDeviceAttributeParams,
  TailscaleSetDeviceAttributeResponse,
} from '@/tools/tailscale/types'
import { assertTailscaleResponse } from '@/tools/tailscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const tailscaleSetDeviceAttributeTool: ToolConfig<
  TailscaleSetDeviceAttributeParams,
  TailscaleSetDeviceAttributeResponse
> = {
  id: 'tailscale_set_device_attribute',
  name: 'Tailscale Set Device Attribute',
  description: 'Create or update a custom device posture attribute with an optional expiry',
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
    attributeValue: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'JSON scalar attribute value: a quoted string, integer, or boolean',
    },
    expiry: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Attribute expiry as an RFC 3339 timestamp',
    },
    comment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reason for setting the posture attribute, up to 200 characters',
    },
  },
  request: {
    url: (params) =>
      `https://api.tailscale.com/api/v2/device/${safeUrlPathSegment(params.deviceId, 'deviceId')}/attributes/${safeUrlPathSegment(params.attributeKey, 'attributeKey')}`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey.trim()}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const value: unknown = JSON.parse(params.attributeValue)
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean')
        throw new Error('Attribute value must be a JSON string, number, or boolean')
      if (typeof value === 'number' && !Number.isSafeInteger(value)) {
        throw new Error('Numeric attribute values must be safe integers')
      }
      return {
        value,
        ...(params.expiry ? { expiry: params.expiry } : {}),
        ...(params.comment ? { comment: params.comment } : {}),
      }
    },
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
