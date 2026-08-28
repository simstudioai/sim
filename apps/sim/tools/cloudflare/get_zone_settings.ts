import type {
  CloudflareGetZoneSettingsParams,
  CloudflareGetZoneSettingsResponse,
  CloudflareRawZoneSetting,
} from '@/tools/cloudflare/types'
import { DEFAULT_ZONE_SETTING_IDS, MAX_ZONE_SETTING_IDS } from '@/tools/cloudflare/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

/** Builds the per-setting endpoint Cloudflare directs integrations at. */
export function zoneSettingUrl(zoneId: string, settingId: string): string {
  return `https://api.cloudflare.com/client/v4/zones/${zoneId}/settings/${encodeURIComponent(settingId)}`
}

/**
 * Flattens one setting onto the output shape. Cloudflare returns complex values
 * (minify, security header, NEL) as objects, so those are JSON-stringified to
 * keep every entry in the list a string.
 */
export function mapZoneSetting(settingId: string, setting: CloudflareRawZoneSetting | undefined) {
  return {
    id: setting?.id ?? settingId,
    value:
      typeof setting?.value === 'object' && setting.value !== null
        ? JSON.stringify(setting.value)
        : String(setting?.value ?? ''),
    editable: setting?.editable ?? false,
    modified_on: setting?.modified_on ?? '',
    ...(setting?.time_remaining != null ? { time_remaining: setting.time_remaining } : {}),
  }
}

export const getZoneSettingsTool: InternalToolConfig<
  CloudflareGetZoneSettingsParams,
  CloudflareGetZoneSettingsResponse
> = {
  id: 'cloudflare_get_zone_settings',
  name: 'Cloudflare Get Zone Settings',
  description: `Reads zone settings such as SSL mode, minimum TLS version, security level, and caching level. Cloudflare retired the endpoint that read every setting in one request, so each setting is read individually — name the ones you need to keep the read small. Defaults to ${DEFAULT_ZONE_SETTING_IDS.join(', ')}.`,
  version: '1.0.0',

  params: {
    zoneId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The zone ID to get settings for',
    },
    settingIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: `Comma-separated setting IDs to read, e.g. "ssl,min_tls_version,security_level". Leave blank to read the default set (${DEFAULT_ZONE_SETTING_IDS.join(', ')}). At most ${MAX_ZONE_SETTING_IDS} settings per call.`,
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Cloudflare API Token',
    },
  },

  operation: {
    input: createInternalToolOperationInput,
  },

  outputs: {
    settings: {
      type: 'array',
      description: 'The zone settings that were readable',
      items: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description:
              'Setting identifier (e.g., ssl, cache_level, security_level, always_use_https)',
          },
          value: {
            type: 'string',
            description: `Setting value as a string. Simple values returned as-is (e.g., "full", "on"). Complex values are JSON-stringified (e.g., {"css":"on","html":"on","js":"on"}).`,
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
      },
    },
    unreadable: {
      type: 'array',
      description:
        'Requested settings Cloudflare refused, typically because the zone plan does not expose them or the setting ID does not exist',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The requested setting identifier' },
          error: { type: 'string', description: 'Why Cloudflare would not return the setting' },
        },
      },
    },
  },
}
