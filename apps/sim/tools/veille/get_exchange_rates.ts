import { toStringOrNull } from '@sim/utils/coerce'
import { toRecord, toRecordOrNull } from '@sim/utils/object'
import type { ToolConfig } from '@/tools/types'
import type {
  VeilleGetExchangeRatesParams,
  VeilleGetExchangeRatesResponse,
} from '@/tools/veille/types'

export const veilleGetExchangeRatesTool: ToolConfig<
  VeilleGetExchangeRatesParams,
  VeilleGetExchangeRatesResponse
> = {
  id: 'veille_get_exchange_rates',
  name: 'Veille Get Exchange Rates',
  description:
    "Get the European Central Bank's daily exchange rates for a base currency, optionally limited to some target currencies.",
  version: '1.0.0',

  params: {
    base: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO 4217 code of the base currency; defaults to EUR (e.g., "USD")',
    },
    symbols: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated ISO 4217 codes to keep (e.g., "EUR,GBP")',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Veille API key',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`https://api.veille.io/v1/vat/rates`)
      if (params.base?.trim()) url.searchParams.set('base', params.base.trim())
      if (params.symbols?.trim()) url.searchParams.set('symbols', params.symbols.trim())
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
        base: toStringOrNull(data.base),
        date: toStringOrNull(data.date),
        rates: toRecordOrNull(data.rates),
      },
    }
  },

  outputs: {
    base: {
      type: 'string',
      description: 'Base currency of the rates',
      optional: true,
    },
    date: {
      type: 'string',
      description: 'Date of the rates (YYYY-MM-DD)',
      optional: true,
    },
    rates: {
      type: 'json',
      description: 'Rates keyed by ISO 4217 currency code, for one unit of the base currency',
      optional: true,
    },
  },
}
