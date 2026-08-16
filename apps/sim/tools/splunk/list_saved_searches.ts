import {
  SAVED_SEARCH_OUTPUT_FIELDS,
  type SplunkListSavedSearchesParams,
  type SplunkListSavedSearchesResponse,
} from '@/tools/splunk/types'
import {
  buildSplunkHeaders,
  buildSplunkUrl,
  getSplunkEntries,
  mapSavedSearchEntry,
  SPLUNK_CONNECTION_PARAMS,
  savedSearchFieldQuery,
} from '@/tools/splunk/utils'
import type { ToolConfig } from '@/tools/types'

export const listSavedSearchesTool: ToolConfig<
  SplunkListSavedSearchesParams,
  SplunkListSavedSearchesResponse
> = {
  id: 'splunk_list_saved_searches',
  name: 'Splunk List Saved Searches',
  description:
    'List saved searches and reports configured in Splunk, including their SPL, schedule, and alert configuration.',
  version: '1.0.0',

  params: {
    ...SPLUNK_CONNECTION_PARAMS,
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter saved searches. A bare term matches as a substring across fields (e.g. Errors); field_name=field_value matches one field (e.g. is_scheduled=1).',
    },
    count: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of saved searches to return (e.g. 50). 0 returns all.',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Index of the first saved search to return, for pagination',
    },
  },

  request: {
    url: (params) =>
      `${buildSplunkUrl(params, '/saved/searches', {
        search: params.search,
        count: params.count,
        offset: params.offset,
      })}&${savedSearchFieldQuery()}`,
    method: 'GET',
    headers: (params) => buildSplunkHeaders(params),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: { savedSearches: getSplunkEntries(data).map(mapSavedSearchEntry) },
    }
  },

  outputs: {
    savedSearches: {
      type: 'array',
      description: 'Saved searches configured in Splunk',
      items: { type: 'object', properties: SAVED_SEARCH_OUTPUT_FIELDS },
    },
  },
}
