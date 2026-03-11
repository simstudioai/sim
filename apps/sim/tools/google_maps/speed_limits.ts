import type {
  GoogleMapsSpeedLimitsParams,
  GoogleMapsSpeedLimitsResponse,
} from '@/tools/google_maps/types'
import type { ToolConfig } from '@/tools/types'

export const googleMapsSpeedLimitsTool: ToolConfig<
  GoogleMapsSpeedLimitsParams,
  GoogleMapsSpeedLimitsResponse
> = {
  id: 'google_maps_speed_limits',
  name: 'Google Maps Speed Limits',
  description: 'Get speed limits for road segments. Requires either path coordinates or placeIds.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Google Maps API key with Roads API enabled',
    },
    path: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pipe-separated list of lat,lng coordinates (required if placeIds not provided)',
    },
    placeIds: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Array of Place IDs for road segments (required if path not provided)',
    },
  },

  request: {
    url: (params) => {
      const hasPath = params.path && params.path.trim().length > 0
      const hasPlaceIds = params.placeIds && params.placeIds.length > 0

      if (!hasPath && !hasPlaceIds) {
        throw new Error(
          'Speed Limits requires either a path (coordinates) or placeIds. Please provide at least one.'
        )
      }

      const url = new URL('https://roads.googleapis.com/v1/speedLimits')
      url.searchParams.set('key', params.apiKey.trim())

      if (hasPath) {
        url.searchParams.set('path', params.path!.trim())
      }

      if (hasPlaceIds) {
        for (const placeId of params.placeIds!) {
          url.searchParams.append('placeId', placeId.trim())
        }
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

    if (data.error) {
      throw new Error(`Speed Limits failed: ${data.error.message || 'Unknown error'}`)
    }

    const speedLimits = (data.speedLimits || []).map(
      (limit: { placeId: string; speedLimit: number; units: 'KPH' | 'MPH' }) => ({
        placeId: limit.placeId,
        speedLimit: limit.speedLimit,
        units: limit.units,
      })
    )

    const snappedPoints = (data.snappedPoints || []).map(
      (point: {
        location: { latitude: number; longitude: number }
        originalIndex?: number
        placeId: string
      }) => ({
        location: {
          lat: point.location.latitude,
          lng: point.location.longitude,
        },
        originalIndex: point.originalIndex,
        placeId: point.placeId,
      })
    )

    return {
      success: true,
      output: {
        speedLimits,
        snappedPoints,
      },
    }
  },

  outputs: {
    speedLimits: {
      type: 'array',
      description: 'Array of speed limits for road segments',
      items: {
        type: 'object',
        properties: {
          placeId: { type: 'string', description: 'Place ID for the road segment' },
          speedLimit: { type: 'number', description: 'Speed limit value' },
          units: { type: 'string', description: 'Speed limit units (KPH or MPH)' },
        },
      },
    },
    snappedPoints: {
      type: 'array',
      description: 'Array of snapped points corresponding to the speed limits',
      items: {
        type: 'object',
        properties: {
          location: {
            type: 'object',
            description: 'Snapped location coordinates',
            properties: {
              lat: { type: 'number', description: 'Latitude' },
              lng: { type: 'number', description: 'Longitude' },
            },
          },
          originalIndex: { type: 'number', description: 'Index in the original path' },
          placeId: { type: 'string', description: 'Place ID for this road segment' },
        },
      },
    },
  },
}
