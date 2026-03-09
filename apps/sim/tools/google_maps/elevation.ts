import type {
  GoogleMapsElevationParams,
  GoogleMapsElevationResponse,
} from '@/tools/google_maps/types'
import type { ToolConfig } from '@/tools/types'

export const googleMapsElevationTool: ToolConfig<
  GoogleMapsElevationParams,
  GoogleMapsElevationResponse
> = {
  id: 'google_maps_elevation',
  name: 'Google Maps Elevation',
  description: 'Get elevation data for a location',
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
  },

  request: {
    url: (params) => {
      const url = new URL('https://maps.googleapis.com/maps/api/elevation/json')
      url.searchParams.set('locations', `${params.lat},${params.lng}`)
      url.searchParams.set('key', params.apiKey.trim())
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
        `Elevation request failed: ${data.status} - ${data.error_message || 'Unknown error'}`
      )
    }

    const result = data.results[0]

    return {
      success: true,
      output: {
        elevation: result.elevation,
        lat: result.location.lat,
        lng: result.location.lng,
        resolution: result.resolution,
      },
    }
  },

  outputs: {
    elevation: {
      type: 'number',
      description: 'Elevation in meters above sea level (negative for below)',
    },
    lat: {
      type: 'number',
      description: 'Latitude of the elevation sample',
    },
    lng: {
      type: 'number',
      description: 'Longitude of the elevation sample',
    },
    resolution: {
      type: 'number',
      description:
        'Maximum distance between data points (meters) from which elevation was interpolated',
    },
  },
}
