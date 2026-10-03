import { ErrorExtractorId } from '@/tools/error-extractors'
import {
  HARMONIC_CONTACT_OUTPUT_PROPERTIES,
  HARMONIC_PAGE_INFO_OUTPUT_PROPERTIES,
  type HarmonicGetPeopleSavedSearchNetNewResultsParams,
  type HarmonicGetPeopleSavedSearchNetNewResultsResponse,
} from '@/tools/harmonic/types'
import {
  buildNetNewResultsUrl,
  harmonicHeaders,
  normalizePageInfo,
  normalizePeopleResults,
  nullableResponseString,
  responseRecord,
} from '@/tools/harmonic/utils'
import type { ToolConfig } from '@/tools/types'

export const harmonicGetPeopleSavedSearchNetNewResultsTool: ToolConfig<
  HarmonicGetPeopleSavedSearchNetNewResultsParams,
  HarmonicGetPeopleSavedSearchNetNewResultsResponse
> = {
  id: 'harmonic_get_people_saved_search_net_new_results',
  name: 'Harmonic Get People Saved Search Net-New Results',
  description:
    'Get only the people newly matching a subscribed Harmonic people saved search, so a monitor does not reprocess the whole result set.',
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
    newResultsSince: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Only return matches after this UTC point, as YYYY-MM-DD or YYYY-MM-DDTHH:00:00Z',
    },
  },

  request: {
    url: (params) =>
      buildNetNewResultsUrl(
        params.savedSearchId,
        params.size,
        params.cursor,
        params.newResultsSince
      ),
    method: 'GET',
    headers: (params) => harmonicHeaders(params.accessToken),
  },

  /**
   * Harmonic keys this collection `urns` rather than `results`, but the element
   * union is identical to the saved-search results endpoint, so the shared
   * person projection applies unchanged.
   */
  transformResponse: async (response) => {
    const data = responseRecord(await response.json(), 'saved-search net-new results')
    const people = normalizePeopleResults(data.urns)
    return {
      success: true,
      output: {
        ...people,
        cursor: nullableResponseString(data.cursor),
        pageInfo: normalizePageInfo(data.page_info),
      },
    }
  },

  outputs: {
    contacts: {
      type: 'array',
      description: 'Newly matching people returned as full profiles, normalized as contacts',
      items: { type: 'object', properties: HARMONIC_CONTACT_OUTPUT_PROPERTIES },
    },
    personUrns: {
      type: 'array',
      description: 'All newly matching person URNs, including rows returned without full profiles',
      items: { type: 'string', description: 'Harmonic person URN' },
    },
    cursor: { type: 'string', nullable: true, description: 'Cursor echoed by Harmonic' },
    pageInfo: {
      type: 'object',
      nullable: true,
      description: 'Cursor pagination metadata',
      properties: HARMONIC_PAGE_INFO_OUTPUT_PROPERTIES,
    },
  },
}
