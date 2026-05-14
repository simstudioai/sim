import type {
  RestCountriesGetByCodeParams,
  RestCountriesResponse,
} from '@/tools/restcountries/types'
import {
  buildRestCountriesUrl,
  encodeRestCountriesPathSegment,
  transformRestCountriesResponse,
} from '@/tools/restcountries/utils'
import type { ToolConfig } from '@/tools/types'

export const restCountriesGetByCodeTool: ToolConfig<
  RestCountriesGetByCodeParams,
  RestCountriesResponse
> = {
  id: 'restcountries_get_by_code',
  name: 'REST Countries Get by Code',
  description:
    'Get country information by ISO 3166-1 alpha-2, alpha-3, numeric, or IOC country code.',
  version: '1.0.0',

  params: {
    code: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Country code, such as "US", "USA", "840", or "CAN"',
    },
  },

  request: {
    url: (params) => buildRestCountriesUrl(`alpha/${encodeRestCountriesPathSegment(params.code)}`),
    method: 'GET',
    headers: () => ({
      Accept: 'application/json',
    }),
  },

  transformResponse: transformRestCountriesResponse,

  outputs: {
    countries: {
      type: 'json',
      description: 'Array containing the country matching the provided code',
    },
    count: {
      type: 'number',
      description: 'Number of countries returned',
    },
    firstCountry: {
      type: 'json',
      description: 'The matching country, or null when there is no match',
      optional: true,
    },
  },
}
