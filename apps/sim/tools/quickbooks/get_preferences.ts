import type {
  QuickBooksPreferencesParams,
  QuickBooksRecordResponse,
} from '@/tools/quickbooks/types'
import {
  buildQuickBooksHeaders,
  buildQuickBooksPreferencesUrl,
  parseQuickBooksJson,
} from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

export const quickBooksGetPreferencesTool: ToolConfig<
  QuickBooksPreferencesParams,
  QuickBooksRecordResponse
> = {
  id: 'quickbooks_get_preferences',
  name: 'QuickBooks Get Preferences',
  description: 'Get company accounting, sales, purchasing, tax, and currency preferences',
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
    url: (params) => buildQuickBooksPreferencesUrl(params),
    method: 'GET',
    headers: (params) => buildQuickBooksHeaders(params.accessToken),
  },
  transformResponse: async (response) => {
    const data = await parseQuickBooksJson(response)
    return {
      success: true,
      output: {
        record: data.Preferences ?? null,
        entity: 'Preferences',
        time: typeof data.time === 'string' ? data.time : null,
      },
    }
  },
  outputs: {
    record: {
      type: 'json',
      description: 'QuickBooks company preferences',
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
