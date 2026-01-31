import type {
  GoogleMapsTimezoneParams,
  GoogleMapsTimezoneResponse,
} from '@/tools/google_maps/types'
import type { ToolConfig } from '@/tools/types'

export const googleMapsTimezoneTool: ToolConfig<
  GoogleMapsTimezoneParams,
  GoogleMapsTimezoneResponse
> = {
  id: 'google_maps_timezone',
  name: 'Google Maps Timezone',
  description: 'Get timezone information for a location',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Google Maps API key',
    },
    lat: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Latitude coordinate',
    },
    lng: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Longitude coordinate',
    },
    timestamp: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Unix timestamp to determine DST offset (defaults to current time)',
    },
    language: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Language code for timezone name (e.g., en, es, fr)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://maps.googleapis.com/maps/api/timezone/json')
      url.searchParams.set('location', `${params.lat},${params.lng}`)
      // Use provided timestamp or current time
      const timestamp = params.timestamp ?? Math.floor(Date.now() / 1000)
      url.searchParams.set('timestamp', timestamp.toString())
      url.searchParams.set('key', params.apiKey.trim())
      if (params.language) {
        url.searchParams.set('language', params.language.trim())
      }
      return url.toString()
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (data.status !== 'OK') {
      throw new Error(
        `Timezone request failed: ${data.status} - ${data.errorMessage || 'Unknown error'}`
      )
    }

    // Calculate total offset
    const totalOffsetSeconds = data.rawOffset + data.dstOffset
    const totalOffsetHours = totalOffsetSeconds / 3600

    return {
      success: true,
      output: {
        timeZoneId: data.timeZoneId,
        timeZoneName: data.timeZoneName,
        rawOffset: data.rawOffset,
        dstOffset: data.dstOffset,
        totalOffsetSeconds,
        totalOffsetHours,
      },
    }
  },

  outputs: {
    timeZoneId: {
      type: 'string',
      description: 'IANA timezone ID (e.g., "America/New_York", "Europe/London")',
    },
    timeZoneName: {
      type: 'string',
      description: 'Localized timezone name (e.g., "Eastern Daylight Time")',
    },
    rawOffset: {
      type: 'number',
      description: 'UTC offset in seconds (without DST)',
    },
    dstOffset: {
      type: 'number',
      description: 'Daylight Saving Time offset in seconds (0 if not in DST)',
    },
    totalOffsetSeconds: {
      type: 'number',
      description: 'Total UTC offset in seconds (rawOffset + dstOffset)',
    },
    totalOffsetHours: {
      type: 'number',
      description: 'Total UTC offset in hours (e.g., -5 for EST, -4 for EDT)',
    },
  },
}
