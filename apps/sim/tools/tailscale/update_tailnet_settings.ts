import { isRecordLike } from '@sim/utils/object'
import { TAILNET_SETTINGS_OUTPUT } from '@/tools/tailscale/outputs'
import type {
  TailscaleTailnetSettings,
  TailscaleUpdateTailnetSettingsParams,
  TailscaleUpdateTailnetSettingsResponse,
} from '@/tools/tailscale/types'
import { assertTailscaleResponse, mapTailscaleTailnetSettings } from '@/tools/tailscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const tailscaleUpdateTailnetSettingsTool: ToolConfig<
  TailscaleUpdateTailnetSettingsParams,
  TailscaleUpdateTailnetSettingsResponse
> = {
  id: 'tailscale_update_tailnet_settings',
  name: 'Tailscale Update Tailnet Settings',
  description: 'Update selected tailnet settings',
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
    settings: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'JSON object of settings to update; omitted settings remain unchanged',
    },
  },
  request: {
    url: (params) =>
      `https://api.tailscale.com/api/v2/tailnet/${safeUrlPathSegment(params.tailnet, 'tailnet')}/settings`,
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey.trim()}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const value: unknown = JSON.parse(params.settings)
      if (!isRecordLike(value)) throw new Error('settings must be a JSON object')
      if ('regionalRoutingOn' in value && 'routeSelection' in value)
        throw new Error('Set routeSelection or regionalRoutingOn, not both')
      return value
    },
  },
  transformResponse: async (response) => {
    await assertTailscaleResponse(response)
    const data: TailscaleTailnetSettings = await response.json()
    return {
      success: true,
      output: {
        settings: mapTailscaleTailnetSettings(data),
      },
    }
  },
  outputs: TAILNET_SETTINGS_OUTPUT,
}
