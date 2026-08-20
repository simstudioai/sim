import { ErrorExtractorId } from '@/tools/error-extractors'
import {
  HARMONIC_SAVED_SEARCH_OUTPUT_PROPERTIES,
  type HarmonicListPeopleSavedSearchesParams,
  type HarmonicListPeopleSavedSearchesResponse,
  type HarmonicSavedSearchOutput,
} from '@/tools/harmonic/types'
import {
  HARMONIC_API_BASE,
  harmonicHeaders,
  normalizeSavedSearch,
  responseArray,
  responseRecord,
} from '@/tools/harmonic/utils'
import type { ToolConfig } from '@/tools/types'

export const harmonicListPeopleSavedSearchesTool: ToolConfig<
  HarmonicListPeopleSavedSearchesParams,
  HarmonicListPeopleSavedSearchesResponse
> = {
  id: 'harmonic_list_people_saved_searches',
  name: 'Harmonic List People Saved Searches',
  description:
    'List the team-shared Harmonic saved searches that target people. Use a returned ID or URN to fetch results.',
  version: '1.0.0',
  oauth: { required: true, provider: 'harmonic' },
  errorExtractor: ErrorExtractorId.HARMONIC_ERRORS,

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Harmonic credential resolved by the connected account',
    },
  },

  request: {
    url: `${HARMONIC_API_BASE}/savedSearches`,
    method: 'GET',
    headers: (params) => harmonicHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const savedSearches = responseArray(await response.json(), 'saved searches')
      .map((item) => responseRecord(item, 'saved search') as HarmonicSavedSearchOutput)
      .filter((item) => item.type === 'PERSONS')
      .map(normalizeSavedSearch)

    return { success: true, output: { savedSearches, count: savedSearches.length } }
  },

  outputs: {
    savedSearches: {
      type: 'array',
      description: 'Team-accessible Harmonic saved searches that target people',
      items: { type: 'object', properties: HARMONIC_SAVED_SEARCH_OUTPUT_PROPERTIES },
    },
    count: { type: 'number', description: 'Number of people saved searches returned' },
  },
}
