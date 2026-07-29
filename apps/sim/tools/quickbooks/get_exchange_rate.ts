import type {
  QuickBooksExchangeRateParams,
  QuickBooksRecordResponse,
} from '@/tools/quickbooks/types'
import {
  buildQuickBooksExchangeRateUrl,
  buildQuickBooksHeaders,
  parseQuickBooksJson,
} from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

export const quickBooksGetExchangeRateTool: ToolConfig<
  QuickBooksExchangeRateParams,
  QuickBooksRecordResponse
> = {
  id: 'quickbooks_get_exchange_rate',
  name: 'QuickBooks Get Exchange Rate',
  description: 'Get a QuickBooks exchange rate for an ISO currency code and optional date',
  version: '1.0.0',
  oauth: { required: true, provider: 'quickbooks' },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for QuickBooks Online',
    },
    realmId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'QuickBooks company ID returned by Intuit as realmId during OAuth',
    },
    sourceCurrencyCode: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Three-letter ISO 4217 source currency code',
    },
    asOfDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exchange rate effective date in YYYY-MM-DD format; defaults to today',
    },
    apiEnvironment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'QuickBooks API environment: production or sandbox. Defaults to production.',
    },
    minorVersion: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'QuickBooks Accounting API minor version. Defaults to 75.',
    },
  },
  request: {
    url: (params) => buildQuickBooksExchangeRateUrl(params),
    method: 'GET',
    headers: (params) => buildQuickBooksHeaders(params.accessToken),
  },
  transformResponse: async (response) => {
    const data = await parseQuickBooksJson(response)
    return {
      success: true,
      output: {
        record: data.ExchangeRate ?? null,
        entity: 'ExchangeRate',
        time: typeof data.time === 'string' ? data.time : null,
      },
    }
  },
  outputs: {
    record: {
      type: 'json',
      description: 'QuickBooks exchange rate',
      optional: true,
    },
    entity: { type: 'string', description: 'QuickBooks entity name' },
    time: {
      type: 'string',
      description: 'QuickBooks response timestamp',
      optional: true,
    },
  },
}
