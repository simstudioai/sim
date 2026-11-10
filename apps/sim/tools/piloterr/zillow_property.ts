import { toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { toArray, toRecord } from '@sim/utils/object'
import type {
  PiloterrZillowPhoto,
  PiloterrZillowPropertyParams,
  PiloterrZillowPropertyResponse,
} from '@/tools/piloterr/types'
import { PILOTERR_ZILLOW_PHOTO_OUTPUT_PROPERTIES } from '@/tools/piloterr/types'
import { mapPiloterrZillowPhoto } from '@/tools/piloterr/utils'
import type { ToolConfig } from '@/tools/types'

export const piloterrZillowPropertyTool: ToolConfig<
  PiloterrZillowPropertyParams,
  PiloterrZillowPropertyResponse
> = {
  id: 'piloterr_zillow_property',
  name: 'Piloterr Get Zillow Property',
  description:
    'Get a Zillow home from its homedetails URL: address, price, Zestimate, status, size, rooms, year built and photos.',
  version: '1.0.0',

  params: {
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Full Zillow homedetails URL (e.g., "https://www.zillow.com/homedetails/20-Kyle-Ct-Staten-Island-NY-10312/32361983_zpid/")',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Piloterr API key',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`https://api.piloterr.com/v2/zillow/property`)
      url.searchParams.set('query', params.url.trim())
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      'x-api-key': params.apiKey,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return {
      success: true,
      output: {
        zpid: toNumberOrNull(data.zpid),
        streetAddress: toStringOrNull(toRecord(data.address).street_address),
        city: toStringOrNull(data.city),
        state: toStringOrNull(data.state),
        zipcode: toStringOrNull(data.zipcode),
        county: toStringOrNull(data.county),
        price: toNumberOrNull(data.price),
        currency: toStringOrNull(data.currency),
        zestimate: toNumberOrNull(data.zestimate),
        homeStatus: toStringOrNull(data.home_status),
        homeType: toStringOrNull(data.home_type),
        bedrooms: toNumberOrNull(data.bedrooms),
        bathrooms: toNumberOrNull(data.bathrooms),
        livingArea: toNumberOrNull(data.living_area),
        lotSize: toNumberOrNull(data.lot_size),
        yearBuilt: toNumberOrNull(data.year_built),
        pricePerSquareFoot: toNumberOrNull(toRecord(data.reso_facts).price_per_square_foot),
        description: toStringOrNull(data.description),
        latitude: toNumberOrNull(data.latitude),
        longitude: toNumberOrNull(data.longitude),
        photos: toArray(data.photos)
          .map(mapPiloterrZillowPhoto)
          .filter((item): item is PiloterrZillowPhoto => item !== null),
      },
    }
  },

  outputs: {
    zpid: {
      type: 'number',
      description: 'Zillow property ID',
      optional: true,
    },
    streetAddress: {
      type: 'string',
      description: 'Street address',
      optional: true,
    },
    city: {
      type: 'string',
      description: 'City',
      optional: true,
    },
    state: {
      type: 'string',
      description: 'State',
      optional: true,
    },
    zipcode: {
      type: 'string',
      description: 'ZIP code',
      optional: true,
    },
    county: {
      type: 'string',
      description: 'County',
      optional: true,
    },
    price: {
      type: 'number',
      description: 'Listing or last sale price',
      optional: true,
    },
    currency: {
      type: 'string',
      description: 'ISO 4217 code of the prices',
      optional: true,
    },
    zestimate: {
      type: 'number',
      description: "Zillow's estimated market value",
      optional: true,
    },
    homeStatus: {
      type: 'string',
      description: 'Status, such as FOR_SALE or RECENTLY_SOLD',
      optional: true,
    },
    homeType: {
      type: 'string',
      description: 'Home type, such as SINGLE_FAMILY',
      optional: true,
    },
    bedrooms: {
      type: 'number',
      description: 'Number of bedrooms',
      optional: true,
    },
    bathrooms: {
      type: 'number',
      description: 'Number of bathrooms',
      optional: true,
    },
    livingArea: {
      type: 'number',
      description: 'Living area in square feet',
      optional: true,
    },
    lotSize: {
      type: 'number',
      description: 'Lot size in square feet',
      optional: true,
    },
    yearBuilt: {
      type: 'number',
      description: 'Year the home was built',
      optional: true,
    },
    pricePerSquareFoot: {
      type: 'number',
      description: 'Price per square foot',
      optional: true,
    },
    description: {
      type: 'string',
      description: 'Listing description',
      optional: true,
    },
    latitude: {
      type: 'number',
      description: 'Latitude',
      optional: true,
    },
    longitude: {
      type: 'number',
      description: 'Longitude',
      optional: true,
    },
    photos: {
      type: 'array',
      description: 'Photos of the home',
      optional: true,
      items: { type: 'object', properties: PILOTERR_ZILLOW_PHOTO_OUTPUT_PROPERTIES },
    },
  },
}
