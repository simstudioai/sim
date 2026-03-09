import type {
  GoogleMapsSnapToRoadsParams,
  GoogleMapsSnapToRoadsResponse,
} from '@/tools/google_maps/types'
import type { ToolConfig } from '@/tools/types'

export const googleMapsSnapToRoadsTool: ToolConfig<
  GoogleMapsSnapToRoadsParams,
  GoogleMapsSnapToRoadsResponse
> = {
  id: 'google_maps_snap_to_roads',
  name: 'Google Maps Snap to Roads',
  description: 'Snap GPS coordinates to the nearest road segment',
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
      required: true,
      visibility: 'user-or-llm',
      description:
        'Pipe-separated list of lat,lng coordinates (e.g., "60.170880,24.942795|60.170879,24.942796")',
    },
    interpolate: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to interpolate additional points along the road',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://roads.googleapis.com/v1/snapToRoads')
      url.searchParams.set('path', params.path.trim())
      url.searchParams.set('key', params.apiKey.trim())
      if (params.interpolate !== undefined) {
        url.searchParams.set('interpolate', String(params.interpolate))
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
      throw new Error(`Snap to Roads failed: ${data.error.message || 'Unknown error'}`)
    }

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
        snappedPoints,
        warningMessage: data.warningMessage || null,
      },
    }
  },

  outputs: {
    snappedPoints: {
      type: 'array',
      description: 'Array of snapped points on roads',
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
          originalIndex: {
            type: 'number',
            description: 'Index in the original path (if not interpolated)',
          },
          placeId: { type: 'string', description: 'Place ID for this road segment' },
        },
      },
    },
    warningMessage: {
      type: 'string',
      description: 'Warning message if any (e.g., if points could not be snapped)',
    },
  },
}
