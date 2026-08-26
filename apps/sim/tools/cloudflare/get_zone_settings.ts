import { getErrorMessage } from '@sim/utils/errors'
import type {
  CloudflareEnvelope,
  CloudflareGetZoneSettingsParams,
  CloudflareGetZoneSettingsResponse,
  CloudflareRawZoneSetting,
} from '@/tools/cloudflare/types'
import {
  cloudflareErrorMessage,
  cloudflareHeaders,
  DEFAULT_ZONE_SETTING_IDS,
  MAX_ZONE_SETTING_IDS,
  requestedZoneSettingIds,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

/**
 * Builds the per-setting endpoint Cloudflare directs integrations at.
 *
 * `zoneId` arrives already guarded — see {@link zoneSettingUrl}'s caller in
 * `directExecution`, which validates it once above the fan-out. Re-guarding it inside the fan-out
 * would raise the same error once per requested setting, turning one bad zone id into up to
 * {@link MAX_ZONE_SETTING_IDS} identical `unreadable` rows before the call failed.
 */
function zoneSettingUrl(guardedZoneId: string, settingId: string): string {
  return `https://api.cloudflare.com/client/v4/zones/${guardedZoneId}/settings/${safeUrlPathSegment(settingId, 'settingIds')}`
}

/**
 * Flattens one setting onto the output shape. Cloudflare returns complex values
 * (minify, security header, NEL) as objects, so those are JSON-stringified to
 * keep every entry in the list a string.
 */
function mapZoneSetting(settingId: string, setting: CloudflareRawZoneSetting | undefined) {
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

export const getZoneSettingsTool: ToolConfig<
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

  request: {
    url: (params) =>
      zoneSettingUrl(
        safeUrlPathSegment(params.zoneId, 'zoneId'),
        requestedZoneSettingIds(params.settingIds)[0]
      ),
    method: 'GET',
    headers: (params) => cloudflareHeaders(params.apiKey),
  },

  /**
   * Cloudflare deprecated the batch `GET /zones/{zone_id}/settings` endpoint,
   * which reaches end of life on 2027-03-31, in favour of one request per
   * setting. The reads are fanned out and gathered back into the single list
   * this tool has always returned.
   *
   * A setting the zone's plan does not expose answers with an error rather than
   * a value, so one refusal must not lose the settings that did come back. Those
   * ids are reported in `unreadable` instead, and only a read where nothing at
   * all was readable fails.
   * https://developers.cloudflare.com/fundamentals/api/reference/deprecations/
   */
  directExecution: async (params, signal) => {
    const settingIds = requestedZoneSettingIds(params.settingIds)
    if (settingIds.length > MAX_ZONE_SETTING_IDS) {
      return {
        success: false,
        output: { settings: [], unreadable: [] },
        error: `Too many settings requested: ${settingIds.length}. Cloudflare reads one setting per request, so at most ${MAX_ZONE_SETTING_IDS} can be read in a single call.`,
      }
    }

    let zoneId: string
    try {
      zoneId = safeUrlPathSegment(params.zoneId, 'zoneId')
    } catch (error) {
      return {
        success: false,
        output: { settings: [], unreadable: [] },
        error: getErrorMessage(error, 'Invalid zoneId'),
      }
    }

    const headers = cloudflareHeaders(params.apiKey)

    const reads = await Promise.all(
      settingIds.map(async (settingId) => {
        try {
          const response = await fetch(zoneSettingUrl(zoneId, settingId), {
            method: 'GET',
            headers,
            signal,
          })
          const data = (await response.json()) as CloudflareEnvelope<CloudflareRawZoneSetting>
          if (!data.success) {
            return {
              settingId,
              error: cloudflareErrorMessage(data, `Failed to read zone setting ${settingId}`),
            }
          }
          return { settingId, setting: mapZoneSetting(settingId, data.result) }
        } catch (error) {
          return {
            settingId,
            error: getErrorMessage(error, `Failed to read zone setting ${settingId}`),
          }
        }
      })
    )

    const settings = reads.flatMap((read) => (read.setting ? [read.setting] : []))
    const unreadable = reads.flatMap((read) =>
      read.error ? [{ id: read.settingId, error: read.error }] : []
    )

    if (settings.length === 0) {
      return {
        success: false,
        output: { settings, unreadable },
        error: unreadable[0]?.error ?? 'Failed to get zone settings',
      }
    }

    return { success: true, output: { settings, unreadable } }
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
