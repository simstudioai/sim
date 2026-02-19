import type {
  CloudflareGetZoneSettingsParams,
  CloudflareGetZoneSettingsResponse,
} from '@/tools/cloudflare/types'
import type { ToolConfig } from '@/tools/types'

export const getZoneSettingsTool: ToolConfig<
  CloudflareGetZoneSettingsParams,
  CloudflareGetZoneSettingsResponse
> = {
  id: 'cloudflare_get_zone_settings',
  name: 'Cloudflare Get Zone Settings',
  description:
    'Gets all settings for a zone including SSL mode, minification, caching level, and security settings.',
  version: '1.0.0',

  params: {
    zoneId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The zone ID to get settings for',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Cloudflare API Token',
    },
  },

  request: {
    url: (params) => `https://api.cloudflare.com/client/v4/zones/${params.zoneId}/settings`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: { settings: [] },
        error: data.errors?.[0]?.message ?? 'Failed to get zone settings',
      }
    }

    return {
      success: true,
      output: {
        settings:
          data.result?.map((setting: Record<string, unknown>) => ({
            id: (setting.id as string) ?? '',
            value: setting.value ?? null,
            editable: (setting.editable as boolean) ?? false,
            modified_on: (setting.modified_on as string) ?? '',
            ...(setting.time_remaining != null
              ? { time_remaining: setting.time_remaining as number }
              : {}),
          })) ?? [],
      },
    }
  },

  outputs: {
    settings: {
      type: 'array',
      description: 'List of zone settings',
      items: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description:
              'Setting identifier (e.g., ssl, minify, cache_level, security_level, always_use_https)',
          },
          value: {
            type: 'json',
            description:
              'Setting value - may be a string, number, boolean, or object depending on the setting',
          },
          editable: {
            type: 'boolean',
            description: 'Whether the setting can be modified for the current zone plan',
          },
          modified_on: {
            type: 'string',
            description: 'ISO 8601 timestamp when the setting was last modified',
          },
          time_remaining: {
            type: 'number',
            description:
              'Seconds remaining until the setting can be modified again (only present for rate-limited settings)',
            optional: true,
          },
        },
      },
    },
  },
}
