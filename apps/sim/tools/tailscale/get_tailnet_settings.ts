import { TAILNET_SETTINGS_OUTPUT } from '@/tools/tailscale/outputs'
import type {
  TailscaleBaseParams,
  TailscaleGetTailnetSettingsResponse,
  TailscaleTailnetSettings,
} from '@/tools/tailscale/types'
import { assertTailscaleResponse, mapTailscaleTailnetSettings } from '@/tools/tailscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const tailscaleGetTailnetSettingsTool: ToolConfig<
  TailscaleBaseParams,
  TailscaleGetTailnetSettingsResponse
> = {
  id: 'tailscale_get_tailnet_settings',
  name: 'Tailscale Get Tailnet Settings',
  description: 'Get tailnet settings',
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
  },
  request: {
    url: (params) =>
      `https://api.tailscale.com/api/v2/tailnet/${safeUrlPathSegment(params.tailnet, 'tailnet')}/settings`,
    method: 'GET',
    headers: (params) => ({ Authorization: `Bearer ${params.apiKey.trim()}` }),
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
