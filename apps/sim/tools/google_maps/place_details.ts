import type {
  GoogleMapsPlaceDetailsParams,
  GoogleMapsPlaceDetailsResponse,
} from '@/tools/google_maps/types'
import type { ToolConfig } from '@/tools/types'

export const googleMapsPlaceDetailsTool: ToolConfig<
  GoogleMapsPlaceDetailsParams,
  GoogleMapsPlaceDetailsResponse
> = {
  id: 'google_maps_place_details',
  name: 'Google Maps Place Details',
  description: 'Get detailed information about a specific place',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Google Maps API key',
    },
    placeId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Google Place ID',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of fields to return',
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
      const url = new URL('https://maps.googleapis.com/maps/api/place/details/json')
      url.searchParams.set('place_id', params.placeId.trim())
      url.searchParams.set('key', params.apiKey.trim())

      // Default fields if not specified - comprehensive list
      const fields =
        params.fields ||
        'place_id,name,formatted_address,geometry,types,rating,user_ratings_total,price_level,website,formatted_phone_number,international_phone_number,opening_hours,reviews,photos,url,utc_offset,vicinity,business_status'
      url.searchParams.set('fields', fields)

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
        `Place details request failed: ${data.status} - ${data.error_message || 'Unknown error'}`
      )
    }

    const place = data.result

    const reviews = (place.reviews || []).map(
      (review: {
        author_name: string
        author_url?: string
        profile_photo_url?: string
        rating: number
        text: string
        time: number
        relative_time_description: string
      }) => ({
        authorName: review.author_name,
        authorUrl: review.author_url ?? null,
        profilePhotoUrl: review.profile_photo_url ?? null,
        rating: review.rating,
        text: review.text,
        time: review.time,
        relativeTimeDescription: review.relative_time_description,
      })
    )

    const photos = (place.photos || []).map(
      (photo: {
        photo_reference: string
        height: number
        width: number
        html_attributions: string[]
      }) => ({
        photoReference: photo.photo_reference,
        height: photo.height,
        width: photo.width,
        htmlAttributions: photo.html_attributions ?? [],
      })
    )

    // Destructure opening hours
    const openNow = place.opening_hours?.open_now ?? null
    const weekdayText = place.opening_hours?.weekday_text ?? []

    // Extract location
    const lat = place.geometry?.location?.lat ?? null
    const lng = place.geometry?.location?.lng ?? null

    return {
      success: true,
      output: {
        placeId: place.place_id,
        name: place.name ?? null,
        formattedAddress: place.formatted_address ?? null,
        lat,
        lng,
        types: place.types ?? [],
        rating: place.rating ?? null,
        userRatingsTotal: place.user_ratings_total ?? null,
        priceLevel: place.price_level ?? null,
        website: place.website ?? null,
        phoneNumber: place.formatted_phone_number ?? null,
        internationalPhoneNumber: place.international_phone_number ?? null,
        openNow,
        weekdayText,
        reviews,
        photos,
        url: place.url ?? null,
        utcOffset: place.utc_offset ?? null,
        vicinity: place.vicinity ?? null,
        businessStatus: place.business_status ?? null,
      },
    }
  },

  outputs: {
    placeId: {
      type: 'string',
      description: 'Google Place ID',
    },
    name: {
      type: 'string',
      description: 'Place name',
      optional: true,
    },
    formattedAddress: {
      type: 'string',
      description: 'Formatted street address',
      optional: true,
    },
    lat: {
      type: 'number',
      description: 'Latitude coordinate',
      optional: true,
    },
    lng: {
      type: 'number',
      description: 'Longitude coordinate',
      optional: true,
    },
    types: {
      type: 'array',
      description: 'Place types (e.g., restaurant, cafe)',
      items: {
        type: 'string',
      },
    },
    rating: {
      type: 'number',
      description: 'Average rating (1.0 to 5.0)',
      optional: true,
    },
    userRatingsTotal: {
      type: 'number',
      description: 'Total number of user ratings',
      optional: true,
    },
    priceLevel: {
      type: 'number',
      description: 'Price level (0=Free, 1=Inexpensive, 2=Moderate, 3=Expensive, 4=Very Expensive)',
      optional: true,
    },
    website: {
      type: 'string',
      description: 'Place website URL',
      optional: true,
    },
    phoneNumber: {
      type: 'string',
      description: 'Local formatted phone number',
      optional: true,
    },
    internationalPhoneNumber: {
      type: 'string',
      description: 'International formatted phone number',
      optional: true,
    },
    openNow: {
      type: 'boolean',
      description: 'Whether the place is currently open',
      optional: true,
    },
    weekdayText: {
      type: 'array',
      description: 'Opening hours formatted by day of week',
      items: {
        type: 'string',
      },
    },
    reviews: {
      type: 'array',
      description: 'User reviews (up to 5 most relevant)',
      items: {
        type: 'object',
        properties: {
          authorName: { type: 'string', description: 'Reviewer name' },
          authorUrl: { type: 'string', description: 'Reviewer profile URL', optional: true },
          profilePhotoUrl: { type: 'string', description: 'Reviewer photo URL', optional: true },
          rating: { type: 'number', description: 'Rating given (1-5)' },
          text: { type: 'string', description: 'Review text' },
          time: { type: 'number', description: 'Review timestamp (Unix epoch)' },
          relativeTimeDescription: {
            type: 'string',
            description: 'Relative time (e.g., "a month ago")',
          },
        },
      },
    },
    photos: {
      type: 'array',
      description: 'Place photos',
      items: {
        type: 'object',
        properties: {
          photoReference: { type: 'string', description: 'Photo reference for Place Photos API' },
          height: { type: 'number', description: 'Photo height in pixels' },
          width: { type: 'number', description: 'Photo width in pixels' },
          htmlAttributions: { type: 'array', description: 'Required attributions' },
        },
      },
    },
    url: {
      type: 'string',
      description: 'Google Maps URL for the place',
      optional: true,
    },
    utcOffset: {
      type: 'number',
      description: 'UTC offset in minutes',
      optional: true,
    },
    vicinity: {
      type: 'string',
      description: 'Simplified address (neighborhood/street)',
      optional: true,
    },
    businessStatus: {
      type: 'string',
      description: 'Business status (OPERATIONAL, CLOSED_TEMPORARILY, CLOSED_PERMANENTLY)',
      optional: true,
    },
  },
}
