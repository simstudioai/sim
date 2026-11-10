import { toArray } from '@sim/utils/object'
import type {
  AutomFindGoogleLocationsParams,
  AutomFindGoogleLocationsResponse,
  AutomLocation,
} from '@/tools/autom/types'
import { AUTOM_LOCATION_OUTPUT_PROPERTIES } from '@/tools/autom/types'
import { mapAutomLocation } from '@/tools/autom/utils'
import type { ToolConfig } from '@/tools/types'

export const automFindGoogleLocationsTool: ToolConfig<
  AutomFindGoogleLocationsParams,
  AutomFindGoogleLocationsResponse
> = {
  id: 'autom_find_google_locations',
  name: 'Autom Find Google Locations',
  description:
    'Find the Google location names that the Location field of Google searches accepts, ordered by reach.',
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'A city, region or country name (e.g., "paris")',
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
      const url = new URL(`https://api.autom.dev/v1/finder/google-locations`)
      url.searchParams.set('query', params.query.trim())
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
        locations: items
          .map(mapAutomLocation)
          .filter((item): item is AutomLocation => item !== null),
      },
    }
  },

  outputs: {
    locations: {
      type: 'array',
      description: 'Matching Google locations, ordered by reach',
      optional: true,
      items: { type: 'object', properties: AUTOM_LOCATION_OUTPUT_PROPERTIES },
    },
  },
}
