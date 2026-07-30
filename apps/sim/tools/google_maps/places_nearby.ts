import type {
  GoogleMapsPlacesNearbyParams,
  GoogleMapsPlacesNearbyResponse,
} from '@/tools/google_maps/types'
import type { ToolConfig } from '@/tools/types'

export const googleMapsPlacesNearbyTool: ToolConfig<
  GoogleMapsPlacesNearbyParams,
  GoogleMapsPlacesNearbyResponse
> = {
  id: 'google_maps_places_nearby',
  name: 'Google Maps Places Nearby Search',
  description: 'Search for places of a given type within a radius of a location',
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
      description: 'Latitude of the center point to search around',
    },
    lng: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Longitude of the center point to search around',
    },
    radius: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Search radius in meters (up to 50000)',
    },
    includedTypes: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Place types to include in the results (e.g., restaurant, cafe)',
    },
    maxResultCount: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return (1-20, defaults to 20)',
    },
    rankPreference: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'How to rank results: POPULARITY (default) or DISTANCE',
    },
    languageCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Language code for the response (e.g., en, es)',
    },
    regionCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Region bias as a ccTLD code (e.g., us, uk)',
    },
  },

  hosting: {
    envKeyPrefix: 'GOOGLE_CLOUD_API_KEY',
    apiKeyParam: 'apiKey',
    byokProviderId: 'google_cloud',
    pricing: {
      type: 'per_request',
      cost: 0.032,
    },
    rateLimit: {
      mode: 'per_request',
      requestsPerMinute: 60,
    },
  },

  request: {
    url: () => 'https://places.googleapis.com/v1/places:searchNearby',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': params.apiKey.trim(),
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.rating,places.userRatingCount,places.priceLevel,places.currentOpeningHours.openNow,places.businessStatus',
    }),
    body: (params) => {
      const body: {
        locationRestriction: {
          circle: { center: { latitude: number; longitude: number }; radius: number }
        }
        includedTypes?: string[]
        maxResultCount?: number
        rankPreference?: string
        languageCode?: string
        regionCode?: string
      } = {
        locationRestriction: {
          circle: {
            center: { latitude: params.lat, longitude: params.lng },
            radius: params.radius,
          },
        },
      }

      if (params.includedTypes && params.includedTypes.length > 0) {
        body.includedTypes = params.includedTypes
      }
      if (params.maxResultCount) {
        body.maxResultCount = params.maxResultCount
      }
      if (params.rankPreference) {
        body.rankPreference = params.rankPreference
      }
      if (params.languageCode) {
        body.languageCode = params.languageCode.trim()
      }
      if (params.regionCode) {
        body.regionCode = params.regionCode.trim()
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok || data.error) {
      throw new Error(`Places Nearby Search failed: ${data.error?.message || response.statusText}`)
    }

    const places = (data.places || []).map(
      (place: {
        id: string
        displayName?: { text?: string }
        formattedAddress?: string
        location?: { latitude: number; longitude: number }
        types?: string[]
        rating?: number
        userRatingCount?: number
        priceLevel?: string
        currentOpeningHours?: { openNow?: boolean }
        businessStatus?: string
      }) => ({
        placeId: place.id,
        name: place.displayName?.text || '',
        formattedAddress: place.formattedAddress ?? null,
        lat: place.location?.latitude ?? null,
        lng: place.location?.longitude ?? null,
        types: place.types ?? [],
        rating: place.rating ?? null,
        userRatingsTotal: place.userRatingCount ?? null,
        priceLevel: place.priceLevel ?? null,
        openNow: place.currentOpeningHours?.openNow ?? null,
        businessStatus: place.businessStatus ?? null,
      })
    )

    return {
      success: true,
      output: {
        places,
      },
    }
  },

  outputs: {
    places: {
      type: 'array',
      description: 'List of places found near the given location',
      items: {
        type: 'object',
        properties: {
          placeId: { type: 'string', description: 'Google Place resource ID' },
          name: { type: 'string', description: 'Place name' },
          formattedAddress: { type: 'string', description: 'Formatted address', optional: true },
          lat: { type: 'number', description: 'Latitude', optional: true },
          lng: { type: 'number', description: 'Longitude', optional: true },
          types: { type: 'array', description: 'Place types' },
          rating: { type: 'number', description: 'Average rating (1-5)', optional: true },
          userRatingsTotal: { type: 'number', description: 'Number of ratings', optional: true },
          priceLevel: {
            type: 'string',
            description: 'Price level (e.g., PRICE_LEVEL_MODERATE)',
            optional: true,
          },
          openNow: { type: 'boolean', description: 'Whether currently open', optional: true },
          businessStatus: { type: 'string', description: 'Business status', optional: true },
        },
      },
    },
  },
}
