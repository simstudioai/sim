import type {
  RestCountriesListByCurrencyParams,
  RestCountriesResponse,
} from '@/tools/restcountries/types'
import {
  buildRestCountriesUrl,
  encodeRestCountriesPathSegment,
  transformRestCountriesResponse,
} from '@/tools/restcountries/utils'
import type { ToolConfig } from '@/tools/types'

export const restCountriesListByCurrencyTool: ToolConfig<
  RestCountriesListByCurrencyParams,
  RestCountriesResponse
> = {
  id: 'restcountries_list_by_currency',
  name: 'REST Countries List by Currency',
  description: 'List countries by currency code or currency name using the REST Countries API.',
  version: '1.0.0',

  params: {
    currency: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Currency code or name, such as "USD", "EUR", or "dollar"',
    },
  },

  request: {
    url: (params) =>
      buildRestCountriesUrl(`currency/${encodeRestCountriesPathSegment(params.currency)}`),
    method: 'GET',
    headers: () => ({
      Accept: 'application/json',
    }),
  },

  transformResponse: transformRestCountriesResponse,

  outputs: {
    countries: {
      type: 'json',
      description: 'Countries using the requested currency',
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
