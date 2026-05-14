import type {
  RestCountriesListByRegionParams,
  RestCountriesResponse,
} from '@/tools/restcountries/types'
import {
  buildRestCountriesUrl,
  encodeRestCountriesPathSegment,
  transformRestCountriesResponse,
} from '@/tools/restcountries/utils'
import type { ToolConfig } from '@/tools/types'

export const restCountriesListByRegionTool: ToolConfig<
  RestCountriesListByRegionParams,
  RestCountriesResponse
> = {
  id: 'restcountries_list_by_region',
  name: 'REST Countries List by Region',
  description: 'List countries in a world region using the REST Countries API.',
  version: '1.0.0',

  params: {
    region: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Region name, such as "Africa", "Americas", "Asia", "Europe", or "Oceania"',
    },
  },

  request: {
    url: (params) =>
      buildRestCountriesUrl(`region/${encodeRestCountriesPathSegment(params.region)}`),
    method: 'GET',
    headers: () => ({
      Accept: 'application/json',
    }),
  },

  transformResponse: transformRestCountriesResponse,

  outputs: {
    countries: {
      type: 'json',
      description: 'Countries in the requested region',
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
