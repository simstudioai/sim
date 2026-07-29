import type {
  QuickBooksExchangeRateParams,
  QuickBooksRecordResponse,
} from '@/tools/quickbooks/types'
import {
  buildQuickBooksExchangeRateBody,
  buildQuickBooksExchangeRateUpdateUrl,
  buildQuickBooksHeaders,
  extractQuickBooksRecord,
  parseQuickBooksJson,
} from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

export const quickBooksUpdateExchangeRateTool: ToolConfig<
  QuickBooksExchangeRateParams,
  QuickBooksRecordResponse
> = {
  id: 'quickbooks_update_exchange_rate',
  name: 'QuickBooks Update Exchange Rate',
  description: 'Create or update a dated QuickBooks exchange rate',
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
    payload: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'ExchangeRate payload with SourceCurrencyCode, TargetCurrencyCode, Rate, AsOfDate, and SyncToken',
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
    url: (params) => buildQuickBooksExchangeRateUpdateUrl(params),
    method: 'POST',
    headers: (params) => buildQuickBooksHeaders(params.accessToken),
    body: (params) => buildQuickBooksExchangeRateBody(params.payload),
  },
  transformResponse: async (response) => {
    const data = await parseQuickBooksJson(response)
    return {
      success: true,
      output: {
        record: extractQuickBooksRecord(data, 'ExchangeRate'),
        entity: 'ExchangeRate',
        time: typeof data.time === 'string' ? data.time : null,
      },
    }
  },
  outputs: {
    record: {
      type: 'json',
      description: 'Updated QuickBooks exchange rate',
    },
    entity: { type: 'string', description: 'QuickBooks entity name' },
    time: {
      type: 'string',
      description: 'QuickBooks response timestamp',
      optional: true,
    },
  },
}
