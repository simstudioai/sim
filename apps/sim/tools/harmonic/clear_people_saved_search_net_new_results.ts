import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  HarmonicClearPeopleSavedSearchNetNewResultsParams,
  HarmonicClearPeopleSavedSearchNetNewResultsResponse,
} from '@/tools/harmonic/types'
import {
  buildClearNetNewResultsUrl,
  harmonicHeaders,
  parsePersonUrns,
} from '@/tools/harmonic/utils'
import type { ToolConfig } from '@/tools/types'

export const harmonicClearPeopleSavedSearchNetNewResultsTool: ToolConfig<
  HarmonicClearPeopleSavedSearchNetNewResultsParams,
  HarmonicClearPeopleSavedSearchNetNewResultsResponse
> = {
  id: 'harmonic_clear_people_saved_search_net_new_results',
  name: 'Harmonic Clear People Saved Search Net-New Results',
  description:
    'Acknowledge net-new people on a saved search so the next poll returns only fresh matches. Clearing everything requires setting the scope explicitly.',
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
    personUrns: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Person URNs to acknowledge when clearScope is "selected". May be a JSON-array string',
    },
    clearScope: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Either "selected" (default, acknowledge only the listed URNs) or "all" (clear every net-new result)',
    },
  },

  request: {
    url: (params) =>
      buildClearNetNewResultsUrl(params.savedSearchId, params.personUrns, params.clearScope),
    method: 'POST',
    headers: (params) => harmonicHeaders(params.accessToken),
  },

  /**
   * Harmonic documents no response body for this endpoint — its OpenAPI entry
   * declares an empty 200 schema — so nothing is parsed out of it. The acknowledged
   * URNs are echoed back from the request so a workflow can chain on them.
   */
  transformResponse: async (response, params) => {
    await response.body?.cancel().catch(() => {})
    const clearedEverything = params?.clearScope === 'all'
    const requested = clearedEverything ? [] : parsePersonUrns(params?.personUrns)
    return {
      success: true,
      output: { cleared: true, clearedPersonUrns: clearedEverything ? null : requested },
    }
  },

  outputs: {
    cleared: { type: 'boolean', description: 'Whether Harmonic accepted the acknowledgement' },
    clearedPersonUrns: {
      type: 'array',
      nullable: true,
      description: 'Person URNs acknowledged, or null when every net-new result was cleared',
      items: { type: 'string', description: 'Harmonic person URN' },
    },
  },
}
