import type {
  RestCountriesListByLanguageParams,
  RestCountriesResponse,
} from '@/tools/restcountries/types'
import {
  buildRestCountriesUrl,
  encodeRestCountriesPathSegment,
  transformRestCountriesResponse,
} from '@/tools/restcountries/utils'
import type { ToolConfig } from '@/tools/types'

export const restCountriesListByLanguageTool: ToolConfig<
  RestCountriesListByLanguageParams,
  RestCountriesResponse
> = {
  id: 'restcountries_list_by_language',
  name: 'REST Countries List by Language',
  description: 'List countries by official language code or language name using REST Countries.',
  version: '1.0.0',

  params: {
    language: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Language code or name, such as "en", "Spanish", or "French"',
    },
  },

  request: {
    url: (params) =>
      buildRestCountriesUrl(`lang/${encodeRestCountriesPathSegment(params.language)}`),
    method: 'GET',
    headers: () => ({
      Accept: 'application/json',
    }),
  },

  transformResponse: transformRestCountriesResponse,

  outputs: {
    countries: {
      type: 'json',
      description: 'Countries using the requested language',
    },
    count: {
      type: 'number',
      description: 'Number of countries returned',
    },
    firstCountry: {
      type: 'json',
      description: 'First country in the returned list, or null when there are no matches',
      optional: true,
    },
  },
}
