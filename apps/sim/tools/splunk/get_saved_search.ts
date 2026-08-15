import {
  SAVED_SEARCH_OUTPUT_FIELDS,
  type SplunkGetSavedSearchParams,
  type SplunkGetSavedSearchResponse,
} from '@/tools/splunk/types'
import {
  buildSplunkHeaders,
  buildSplunkUrl,
  getSplunkEntries,
  mapSavedSearchEntry,
  SPLUNK_CONNECTION_PARAMS,
} from '@/tools/splunk/utils'
import type { ToolConfig } from '@/tools/types'

export const getSavedSearchTool: ToolConfig<
  SplunkGetSavedSearchParams,
  SplunkGetSavedSearchResponse
> = {
  id: 'splunk_get_saved_search',
  name: 'Splunk Get Saved Search',
  description:
    'Get the configuration of a single Splunk saved search by name, including its SPL, schedule, and alert settings.',
  version: '1.0.0',

  params: {
    ...SPLUNK_CONNECTION_PARAMS,
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the saved search (e.g. Errors in the last 24 hours)',
    },
  },

  request: {
    url: (params) => buildSplunkUrl(params, `/saved/searches/${encodeURIComponent(params.name)}`),
    method: 'GET',
    headers: (params) => buildSplunkHeaders(params),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return { success: true, output: mapSavedSearchEntry(getSplunkEntries(data)[0]) }
  },

  outputs: SAVED_SEARCH_OUTPUT_FIELDS,
}
