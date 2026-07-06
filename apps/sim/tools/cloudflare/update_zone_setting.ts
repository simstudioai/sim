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
    'Updates a specific zone setting such as SSL mode, security level, cache level, or other configuration.',
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
        'Setting to update (e.g., "ssl", "security_level", "cache_level", "always_use_https", "browser_cache_ttl", "http3", "min_tls_version", "ciphers")',
    },
    value: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'New value for the setting as a string or JSON string for complex values (e.g., "full" for SSL, "medium" for security_level, "aggressive" for cache_level, \'["ECDHE-RSA-AES128-GCM-SHA256"]\' for ciphers)',
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
      const trimmed = params.value.trim()

      // browser_cache_ttl is the one setting whose value must be a number.
      if (params.settingId === 'browser_cache_ttl') {
        const numeric = Number(trimmed)
        return { value: Number.isNaN(numeric) ? params.value : numeric }
      }

      // Only parse JSON object/array literals (e.g. ciphers). Scalar settings like
      // min_tls_version ("1.2") or tls_1_3 ("on") must stay strings — a blind JSON.parse would
      // silently coerce them to numbers/booleans and the Cloudflare API would reject the type.
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          return { value: JSON.parse(trimmed) }
        } catch {
          return { value: params.value }
        }
      }
      return { value: params.value }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: { id: '', value: '', editable: false, modified_on: '' },
        error: data.errors?.[0]?.message ?? 'Failed to update zone setting',
      }
    }

    const setting = data.result
    return {
      success: true,
      output: {
        id: setting?.id ?? '',
        value:
          typeof setting?.value === 'object' && setting?.value !== null
            ? JSON.stringify(setting.value)
            : String(setting?.value ?? ''),
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
      description: 'Setting identifier (e.g., ssl, cache_level, security_level)',
    },
    value: {
      type: 'string',
      description:
        'Updated setting value as a string. Simple values returned as-is (e.g., "full", "on"). Complex values are JSON-stringified.',
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
