import type {
  RestCountriesResponse,
  RestCountriesSearchByNameParams,
} from '@/tools/restcountries/types'
import {
  buildRestCountriesUrl,
  encodeRestCountriesPathSegment,
  transformRestCountriesResponse,
} from '@/tools/restcountries/utils'
import type { ToolConfig } from '@/tools/types'

export const restCountriesSearchByNameTool: ToolConfig<
  RestCountriesSearchByNameParams,
  RestCountriesResponse
> = {
  id: 'restcountries_search_by_name',
  name: 'REST Countries Search by Name',
  description:
    'Search for countries by common or official country name using the REST Countries API.',
  version: '1.0.0',

  params: {
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Country name to search for, such as "Canada" or "Republic of Korea"',
    },
    fullText: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Require an exact full-name match when true',
    },
  },

  request: {
    url: (params) =>
      buildRestCountriesUrl(`name/${encodeRestCountriesPathSegment(params.name)}`, {
        ...(params.fullText ? { fullText: 'true' } : {}),
      }),
    method: 'GET',
    headers: () => ({
      Accept: 'application/json',
    }),
  },

  transformResponse: transformRestCountriesResponse,

  outputs: {
    countries: {
      type: 'json',
      description: 'Countries matching the name search',
    },
    count: {
      type: 'number',
      description: 'Number of countries returned',
    },
    firstCountry: {
      type: 'json',
      description: 'First matching country, or null when there are no matches',
      optional: true,
    },
  },
}
