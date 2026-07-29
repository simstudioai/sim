import type {
  QuickBooksRecordResponse,
  QuickBooksUpdatePreferencesParams,
} from '@/tools/quickbooks/types'
import {
  buildQuickBooksHeaders,
  buildQuickBooksPreferencesBody,
  buildQuickBooksPreferencesUrl,
  extractQuickBooksRecord,
  parseQuickBooksJson,
} from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

export const quickBooksUpdatePreferencesTool: ToolConfig<
  QuickBooksUpdatePreferencesParams,
  QuickBooksRecordResponse
> = {
  id: 'quickbooks_update_preferences',
  name: 'QuickBooks Update Preferences',
  description: 'Update supported QuickBooks company accounting and workflow preferences',
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
      description: 'QuickBooks Preferences payload containing the supported settings to update',
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
    method: 'POST',
    headers: (params) => buildQuickBooksHeaders(params.accessToken),
    body: (params) => buildQuickBooksPreferencesBody(params.payload),
  },
  transformResponse: async (response) => {
    const data = await parseQuickBooksJson(response)
    return {
      success: true,
      output: {
        record: extractQuickBooksRecord(data, 'Preferences'),
        entity: 'Preferences',
        time: typeof data.time === 'string' ? data.time : null,
      },
    }
  },
  outputs: {
    record: {
      type: 'json',
      description: 'Updated QuickBooks company preferences',
    },
    entity: { type: 'string', description: 'QuickBooks entity name' },
    time: {
      type: 'string',
      description: 'QuickBooks response timestamp',
      optional: true,
    },
  },
}
