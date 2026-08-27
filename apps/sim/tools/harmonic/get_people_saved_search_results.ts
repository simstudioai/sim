import { ErrorExtractorId } from '@/tools/error-extractors'
import {
  HARMONIC_CONTACT_OUTPUT_PROPERTIES,
  HARMONIC_PAGE_INFO_OUTPUT_PROPERTIES,
  type HarmonicGetPeopleSavedSearchResultsParams,
  type HarmonicGetPeopleSavedSearchResultsResponse,
} from '@/tools/harmonic/types'
import {
  buildPagedUrl,
  harmonicHeaders,
  normalizePageInfo,
  normalizePeopleResults,
  nullableResponseNumber,
  requireIdentifier,
  responseRecord,
} from '@/tools/harmonic/utils'
import type { ToolConfig } from '@/tools/types'

export const harmonicGetPeopleSavedSearchResultsTool: ToolConfig<
  HarmonicGetPeopleSavedSearchResultsParams,
  HarmonicGetPeopleSavedSearchResultsResponse
> = {
  id: 'harmonic_get_people_saved_search_results',
  name: 'Harmonic Get People Saved Search Results',
  description:
    'Get one page of a Harmonic people saved search. Full records become contacts; URN-only rows are exposed for Batch Get People.',
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
    savedSearchId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'People saved-search ID or full Harmonic saved-search URN',
    },
    size: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Results to return; Sim caps this at 100 per page (default 50)',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Opaque next-page cursor from a previous response',
    },
  },

  request: {
    url: (params) =>
      buildPagedUrl(
        `/savedSearches:results/${encodeURIComponent(
          requireIdentifier(params.savedSearchId, 'savedSearchId')
        )}`,
        params.size,
        params.cursor
      ),
    method: 'GET',
    headers: (params) => harmonicHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = responseRecord(await response.json(), 'saved-search results')
    const people = normalizePeopleResults(data.results)
    return {
      success: true,
      output: {
        ...people,
        totalCount: nullableResponseNumber(data.count),
        pageInfo: normalizePageInfo(data.page_info),
      },
    }
  },

  outputs: {
    contacts: {
      type: 'array',
      description: 'Full person records returned by the saved search, normalized as contacts',
      items: { type: 'object', properties: HARMONIC_CONTACT_OUTPUT_PROPERTIES },
    },
    personUrns: {
      type: 'array',
      description: 'All person URNs in the page, including rows returned without full profiles',
      items: { type: 'string', description: 'Harmonic person URN' },
    },
    totalCount: { type: 'number', nullable: true, description: 'Total matching people' },
    pageInfo: {
      type: 'object',
      nullable: true,
      description: 'Cursor pagination metadata',
      properties: HARMONIC_PAGE_INFO_OUTPUT_PROPERTIES,
    },
  },
}
