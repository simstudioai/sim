import type { GoogleMapsGeocodeParams, GoogleMapsGeocodeResponse } from '@/tools/google_maps/types'
import type { ToolConfig } from '@/tools/types'

export const googleMapsGeocodeTool: ToolConfig<GoogleMapsGeocodeParams, GoogleMapsGeocodeResponse> =
  {
    id: 'google_maps_geocode',
    name: 'Google Maps Geocode',
    description: 'Convert an address into geographic coordinates (latitude and longitude)',
    version: '1.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Google Maps API key',
      },
      address: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The address to geocode',
      },
      language: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Language code for results (e.g., en, es, fr)',
      },
      region: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Region bias as a ccTLD code (e.g., us, uk)',
      },
    },

    request: {
      url: (params) => {
        const url = new URL('https://maps.googleapis.com/maps/api/geocode/json')
        url.searchParams.set('address', params.address.trim())
        url.searchParams.set('key', params.apiKey.trim())
        if (params.language) {
          url.searchParams.set('language', params.language.trim())
        }
        if (params.region) {
          url.searchParams.set('region', params.region.trim())
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
          `Geocoding failed: ${data.status} - ${data.error_message || 'Unknown error'}`
        )
      }

      const result = data.results[0]
      const location = result.geometry.location

      return {
        success: true,
        output: {
          formattedAddress: result.formatted_address,
          lat: location.lat,
          lng: location.lng,
          location: {
            lat: location.lat,
            lng: location.lng,
          },
          placeId: result.place_id,
          addressComponents: (result.address_components || []).map(
            (comp: { long_name: string; short_name: string; types: string[] }) => ({
              longName: comp.long_name,
              shortName: comp.short_name,
              types: comp.types,
            })
          ),
          locationType: result.geometry.location_type,
        },
      }
    },

    outputs: {
      formattedAddress: {
        type: 'string',
        description: 'The formatted address string',
      },
      lat: {
        type: 'number',
        description: 'Latitude coordinate',
      },
      lng: {
        type: 'number',
        description: 'Longitude coordinate',
      },
      location: {
        type: 'json',
        description: 'Location object with lat and lng',
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
      locationType: {
        type: 'string',
        description: 'Location accuracy type (ROOFTOP, RANGE_INTERPOLATED, etc.)',
      },
    },
  }
