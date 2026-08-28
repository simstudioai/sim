import { getErrorMessage } from '@sim/utils/errors'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import { mapZoneSetting, zoneSettingUrl } from '@/tools/cloudflare/get_zone_settings'
import type {
  CloudflareEnvelope,
  CloudflareGetZoneSettingsParams,
  CloudflareRawZoneSetting,
} from '@/tools/cloudflare/types'
import {
  cloudflareErrorMessage,
  cloudflareHeaders,
  MAX_ZONE_SETTING_IDS,
  requestedZoneSettingIds,
} from '@/tools/cloudflare/utils'

export const executeGetZoneSettingsOperation: InternalToolOperationImplementation<
  CloudflareGetZoneSettingsParams
> = async (params, signal) => {
  const settingIds = requestedZoneSettingIds(params.settingIds)
  if (settingIds.length > MAX_ZONE_SETTING_IDS) {
    return {
      success: false,
      output: { settings: [], unreadable: [] },
      error: `Too many settings requested: ${settingIds.length}. Cloudflare reads one setting per request, so at most ${MAX_ZONE_SETTING_IDS} can be read in a single call.`,
    }
  }

  const zoneId = params.zoneId.trim()
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
        signal?.throwIfAborted()
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
}
