import type {
  GoogleMapsReverseGeocodeParams,
  GoogleMapsReverseGeocodeResponse,
} from '@/tools/google_maps/types'
import type { ToolConfig } from '@/tools/types'

export const googleMapsReverseGeocodeTool: ToolConfig<
  GoogleMapsReverseGeocodeParams,
  GoogleMapsReverseGeocodeResponse
> = {
  id: 'google_maps_reverse_geocode',
  name: 'Google Maps Reverse Geocode',
  description:
    'Convert geographic coordinates (latitude and longitude) into a human-readable address',
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
    language: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Language code for results (e.g., en, es, fr)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://maps.googleapis.com/maps/api/geocode/json')
      url.searchParams.set('latlng', `${params.lat},${params.lng}`)
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
        `Reverse geocoding failed: ${data.status} - ${data.error_message || 'Unknown error'}`
      )
    }

    const result = data.results[0]

    return {
      success: true,
      output: {
        formattedAddress: result.formatted_address,
        placeId: result.place_id,
        addressComponents: (result.address_components || []).map(
          (comp: { long_name: string; short_name: string; types: string[] }) => ({
            longName: comp.long_name,
            shortName: comp.short_name,
            types: comp.types,
          })
        ),
        types: result.types || [],
      },
    }
  },

  outputs: {
    formattedAddress: {
      type: 'string',
      description: 'The formatted address string',
    },
    placeId: {
      type: 'string',
      description: 'Google Place ID for this location',
    },
    addressComponents: {
      type: 'array',
      description: 'Detailed address components',
      items: {
        type: 'object',
        properties: {
          longName: { type: 'string', description: 'Full name of the component' },
          shortName: { type: 'string', description: 'Abbreviated name' },
          types: { type: 'array', description: 'Component types' },
        },
      },
    },
    types: {
      type: 'array',
      description: 'Address types (e.g., street_address, route)',
      items: {
        type: 'string',
      },
    },
  },
}
