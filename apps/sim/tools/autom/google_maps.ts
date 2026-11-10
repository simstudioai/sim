import { toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { toArray, toRecordOrNull } from '@sim/utils/object'
import type {
  AutomGoogleMapsParams,
  AutomGoogleMapsResponse,
  AutomPlace,
} from '@/tools/autom/types'
import { AUTOM_PLACE_OUTPUT_PROPERTIES } from '@/tools/autom/types'
import type { ToolConfig } from '@/tools/types'

/** Reads a `AutomPlace` from an untyped Autom API payload. */
function mapAutomPlace(value: unknown): AutomPlace | null {
  const record = toRecordOrNull(value)
  if (!record) return null
  return {
    title: toStringOrNull(record.title),
    address: toStringOrNull(record.address),
    website: toStringOrNull(record.website),
    phoneNumber: toStringOrNull(record.phone_number),
    latitude: toNumberOrNull(record.lat),
    longitude: toNumberOrNull(record.long),
    placeId: toStringOrNull(record.fid),
  }
}

export const automGoogleMapsTool: ToolConfig<AutomGoogleMapsParams, AutomGoogleMapsResponse> = {
  id: 'autom_google_maps',
  name: 'Autom Google Maps',
  description:
    'Search Google Maps and get places with address, website, phone number and coordinates.',
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Search query (e.g., "best electric cars")',
    },
    country: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Two-letter country code to search from (e.g., "us")',
    },
    language: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Two-letter language code of the results (e.g., "en")',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page of results, starting at 1',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Autom API key',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`https://api.autom.dev/v1/google/maps`)
      url.searchParams.set('query', params.query.trim())
      if (params.country?.trim()) url.searchParams.set('gl', params.country.trim())
      if (params.language?.trim()) url.searchParams.set('hl', params.language.trim())
      if (params.page != null) url.searchParams.set('page', String(params.page))
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      'x-api-key': params.apiKey,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const items = toArray(await response.json())
    return {
      success: true,
      output: {
        places: items.map(mapAutomPlace).filter((item): item is AutomPlace => item !== null),
      },
    }
  },

  outputs: {
    places: {
      type: 'array',
      description: 'Places found on Google Maps',
      optional: true,
      items: { type: 'object', properties: AUTOM_PLACE_OUTPUT_PROPERTIES },
    },
  },
}
