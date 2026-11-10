import { toArray, toRecord } from '@sim/utils/object'
import type {
  AutomGoogleAutocompleteParams,
  AutomGoogleAutocompleteResponse,
  AutomSuggestion,
} from '@/tools/autom/types'
import { AUTOM_SUGGESTION_OUTPUT_PROPERTIES } from '@/tools/autom/types'
import { mapAutomSuggestion } from '@/tools/autom/utils'
import type { ToolConfig } from '@/tools/types'

export const automGoogleAutocompleteTool: ToolConfig<
  AutomGoogleAutocompleteParams,
  AutomGoogleAutocompleteResponse
> = {
  id: 'autom_google_autocomplete',
  name: 'Autom Google Autocomplete',
  description: 'Get the Google Search autocomplete suggestions for a partial query.',
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
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Autom API key',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`https://api.autom.dev/v1/google/search/autocomplete`)
      url.searchParams.set('query', params.query.trim())
      if (params.country?.trim()) url.searchParams.set('gl', params.country.trim())
      if (params.language?.trim()) url.searchParams.set('hl', params.language.trim())
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
        suggestions: toArray(data.suggestions)
          .map(mapAutomSuggestion)
          .filter((item): item is AutomSuggestion => item !== null),
      },
    }
  },

  outputs: {
    suggestions: {
      type: 'array',
      description: 'Autocomplete suggestions',
      optional: true,
      items: { type: 'object', properties: AUTOM_SUGGESTION_OUTPUT_PROPERTIES },
    },
  },
}
