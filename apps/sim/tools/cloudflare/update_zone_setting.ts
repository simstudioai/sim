import { isRecordLike } from '@sim/utils/object'
import { mapZoneSetting } from '@/tools/cloudflare/get_zone_settings'
import type {
  CloudflareRawZoneSetting,
  CloudflareUpdateZoneSettingParams,
  CloudflareUpdateZoneSettingResponse,
} from '@/tools/cloudflare/types'
import { readCloudflareResponse } from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

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
    enabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Enrollment value for ssl_recommender; this setting uses enabled instead of value',
    },
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
      required: false,
      visibility: 'user-or-llm',
      description: `Required except for ssl_recommender. New value as a string, or a JSON string for complex values (e.g., "full" for SSL, "medium" for security_level, "aggressive" for cache_level, ["ECDHE-RSA-AES128-GCM-SHA256"] for ciphers)`,
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
      `https://api.cloudflare.com/client/v4/zones/${safeUrlPathSegment(params.zoneId, 'zoneId')}/settings/${safeUrlPathSegment(params.settingId, 'settingId')}`,
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      if (params.settingId.trim() === 'ssl_recommender') {
        if (typeof params.enabled !== 'boolean')
          throw new Error('enabled is required for ssl_recommender')
        return { enabled: params.enabled }
      }
      if (params.value === undefined || params.value === null)
        throw new Error('value is required for this zone setting')
      // Resolved block outputs may already be structured JSON.
      if (params.value !== null && typeof params.value === 'object') {
        return { value: params.value }
      }

      const trimmed = String(params.value).trim()

      // Number('') is zero, so preserve empty numeric input for the provider's validation.
      if (
        [
          'browser_cache_ttl',
          'challenge_ttl',
          'edge_cache_ttl',
          'max_upload',
          'origin_h2_max_streams',
          'proxy_read_timeout',
        ].includes(params.settingId.trim())
      ) {
        const numeric = trimmed === '' ? Number.NaN : Number(trimmed)
        return { value: Number.isNaN(numeric) ? trimmed : numeric }
      }

      // Only parse JSON object/array literals (e.g. ciphers). Scalar settings like
      // min_tls_version ("1.2") or tls_1_3 ("on") must stay strings — a blind JSON.parse would
      // silently coerce them to numbers/booleans and the Cloudflare API would reject the type.
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          return { value: JSON.parse(trimmed) }
        } catch {
          return { value: trimmed }
        }
      }
      return { value: trimmed }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await readCloudflareResponse<CloudflareRawZoneSetting>(response)

    if (!response.ok || data.success !== true || !isRecordLike(data.result)) {
      return {
        success: false,
        output: { id: '', value: '', editable: false, modified_on: '' },
        error: data.errors?.[0]?.message ?? 'Failed to update zone setting',
      }
    }

    const setting = data.result
    return {
      success: true,
      output: mapZoneSetting(typeof setting.id === 'string' ? setting.id : '', setting),
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
        'Updated setting value as a string. Simple values returned as-is (e.g., "full", "on"). SSL Recommender returns its enabled flag. Complex values are JSON-stringified.',
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
        'Development mode countdown, in seconds. Cloudflare documents this only on the zones_development_mode setting, where it is the interval from when development mode expires (positive) or last expired (negative)',
      optional: true,
    },
  },
}
