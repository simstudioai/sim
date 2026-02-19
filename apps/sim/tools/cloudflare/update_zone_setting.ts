import type {
  CloudflareUpdateZoneSettingParams,
  CloudflareUpdateZoneSettingResponse,
} from '@/tools/cloudflare/types'
import type { ToolConfig } from '@/tools/types'

export const updateZoneSettingTool: ToolConfig<
  CloudflareUpdateZoneSettingParams,
  CloudflareUpdateZoneSettingResponse
> = {
  id: 'cloudflare_update_zone_setting',
  name: 'Cloudflare Update Zone Setting',
  description:
    'Updates a specific zone setting such as SSL mode, security level, cache level, minification, or other configuration.',
  version: '1.0.0',

  params: {
    zoneId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The zone ID to update settings for',
    },
    settingId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Setting to update (e.g., "ssl", "security_level", "cache_level", "minify", "always_use_https", "browser_cache_ttl", "http3", "min_tls_version", "ciphers")',
    },
    value: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'New value for the setting as a string or JSON string for complex values (e.g., "full" for SSL, "medium" for security_level, "aggressive" for cache_level, \'{"css":"on","html":"on","js":"on"}\' for minify, \'["ECDHE-RSA-AES128-GCM-SHA256"]\' for ciphers)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Cloudflare API Token',
    },
  },

  request: {
    url: (params) =>
      `https://api.cloudflare.com/client/v4/zones/${params.zoneId}/settings/${params.settingId}`,
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      try {
        return { value: JSON.parse(params.value) }
      } catch {
        return { value: params.value }
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: { id: '', value: null, editable: false, modified_on: '' },
        error: data.errors?.[0]?.message ?? 'Failed to update zone setting',
      }
    }

    const setting = data.result
    return {
      success: true,
      output: {
        id: setting?.id ?? '',
        value: setting?.value ?? null,
        editable: setting?.editable ?? false,
        modified_on: setting?.modified_on ?? '',
        ...(setting?.time_remaining != null
          ? { time_remaining: setting.time_remaining as number }
          : {}),
      },
    }
  },

  outputs: {
    id: {
      type: 'string',
      description: 'Setting identifier (e.g., ssl, minify, cache_level)',
    },
    value: {
      type: 'json',
      description:
        'Updated setting value - may be a string, number, boolean, or object depending on the setting',
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
}
