import { DEVICE_OUTPUT_PROPERTIES } from '@/tools/tailscale/outputs'
import type {
  TailscaleDevice,
  TailscaleListDevicesParams,
  TailscaleListDevicesResponse,
} from '@/tools/tailscale/types'
import { assertTailscaleResponse, mapTailscaleDevice } from '@/tools/tailscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const tailscaleListDevicesTool: ToolConfig<
  TailscaleListDevicesParams,
  TailscaleListDevicesResponse
> = {
  id: 'tailscale_list_devices',
  name: 'Tailscale List Devices',
  description: 'List devices in the tailnet',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'Tailscale API access token or OAuth access token (not an auth key or OAuth client secret)',
    },
    tailnet: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Tailnet ID, legacy name, or "-" for the token’s default tailnet',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Device fields to return: default or all',
    },
    filters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'URL query filters for top-level device fields, e.g. isEphemeral=true&tags=tag:server',
    },
  },
  request: {
    url: (params) => {
      const query = new URLSearchParams(params.filters?.trim())
      if (query.has('fields')) throw new Error('Use the Fields input instead of a fields filter')
      if (params.fields) query.set('fields', params.fields)
      return `https://api.tailscale.com/api/v2/tailnet/${safeUrlPathSegment(params.tailnet, 'tailnet')}/devices${query.size ? `?${query}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({ Authorization: `Bearer ${params.apiKey.trim()}` }),
  },
  transformResponse: async (response) => {
    await assertTailscaleResponse(response)
    const data: { devices?: TailscaleDevice[] } = await response.json()
    const devices = (data.devices ?? []).map(mapTailscaleDevice)
    return { success: true, output: { devices, count: devices.length } }
  },
  outputs: {
    devices: {
      type: 'array',
      description: 'Devices in the tailnet',
      items: { type: 'object', properties: DEVICE_OUTPUT_PROPERTIES },
    },
    count: { type: 'number', description: 'Number of returned items' },
  },
}
