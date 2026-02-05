import type {
  GoogleMapsPlacesSearchParams,
  GoogleMapsPlacesSearchResponse,
} from '@/tools/google_maps/types'
import type { ToolConfig } from '@/tools/types'

export const googleMapsPlacesSearchTool: ToolConfig<
  GoogleMapsPlacesSearchParams,
  GoogleMapsPlacesSearchResponse
> = {
  id: 'google_maps_places_search',
  name: 'Google Maps Places Search',
  description: 'Search for places using a text query',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Google Maps API key',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Search query (e.g., "restaurants in Times Square")',
    },
    location: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Location to bias results towards ({lat, lng})',
    },
    radius: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search radius in meters',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Place type filter (e.g., restaurant, cafe, hotel)',
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
      const url = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json')
      url.searchParams.set('query', params.query.trim())
      url.searchParams.set('key', params.apiKey.trim())

      if (params.location) {
        url.searchParams.set('location', `${params.location.lat},${params.location.lng}`)
      }
      if (params.radius) {
        url.searchParams.set('radius', params.radius.toString())
      }
      if (params.type) {
        url.searchParams.set('type', params.type)
      }
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

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      throw new Error(
        `Places search failed: ${data.status} - ${data.error_message || 'Unknown error'}`
      )
    }

    const places = (data.results || []).map(
      (place: {
        place_id: string
        name: string
        formatted_address: string
        geometry: { location: { lat: number; lng: number } }
        types: string[]
        rating?: number
        user_ratings_total?: number
        price_level?: number
        opening_hours?: { open_now: boolean }
        photos?: Array<{ photo_reference: string; height: number; width: number }>
        business_status?: string
      }) => ({
        placeId: place.place_id,
        name: place.name,
        formattedAddress: place.formatted_address,
        lat: place.geometry.location.lat,
        lng: place.geometry.location.lng,
        types: place.types ?? [],
        rating: place.rating ?? null,
        userRatingsTotal: place.user_ratings_total ?? null,
        priceLevel: place.price_level ?? null,
        openNow: place.opening_hours?.open_now ?? null,
        photoReference: place.photos?.[0]?.photo_reference ?? null,
        businessStatus: place.business_status ?? null,
      })
    )

    return {
      success: true,
      output: {
        places,
        nextPageToken: data.next_page_token ?? null,
      },
    }
  },

  outputs: {
    places: {
      type: 'array',
      description: 'List of places found',
      items: {
        type: 'object',
        properties: {
          placeId: { type: 'string', description: 'Google Place ID' },
          name: { type: 'string', description: 'Place name' },
          formattedAddress: { type: 'string', description: 'Formatted address' },
          lat: { type: 'number', description: 'Latitude' },
          lng: { type: 'number', description: 'Longitude' },
          types: { type: 'array', description: 'Place types' },
          rating: { type: 'number', description: 'Average rating (1-5)', optional: true },
          userRatingsTotal: { type: 'number', description: 'Number of ratings', optional: true },
          priceLevel: { type: 'number', description: 'Price level (0-4)', optional: true },
          openNow: { type: 'boolean', description: 'Whether currently open', optional: true },
          photoReference: {
            type: 'string',
            description: 'Photo reference for Photos API',
            optional: true,
          },
          businessStatus: { type: 'string', description: 'Business status', optional: true },
        },
      },
    },
    nextPageToken: {
      type: 'string',
      description: 'Token for fetching the next page of results',
      optional: true,
    },
  },
}
