import type {
  QuickBooksCreateRecordParams,
  QuickBooksRecordResponse,
} from '@/tools/quickbooks/types'
import {
  buildQuickBooksCreateBody,
  buildQuickBooksHeaders,
  buildQuickBooksRecordUrl,
  extractQuickBooksRecord,
  parseQuickBooksJson,
} from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

export const quickBooksCreateRecordTool: ToolConfig<
  QuickBooksCreateRecordParams,
  QuickBooksRecordResponse
> = {
  id: 'quickbooks_create_record',
  name: 'QuickBooks Create Record',
  description: 'Create a supported QuickBooks Online accounting record',
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
    entity: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Creatable QuickBooks entity name',
    },
    payload: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Entity payload using the fields documented by the QuickBooks API',
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
    url: (params) =>
      buildQuickBooksRecordUrl({
        ...params,
        operation: 'create',
      }).url,
    method: 'POST',
    headers: (params) => buildQuickBooksHeaders(params.accessToken),
    body: (params) => buildQuickBooksCreateBody(params.payload),
  },

  transformResponse: async (response, params) => {
    if (!params) throw new Error('QuickBooks record parameters are required')
    const { entity } = buildQuickBooksRecordUrl({ ...params, operation: 'create' })
    const data = await parseQuickBooksJson(response)

    return {
      success: true,
      output: {
        record: extractQuickBooksRecord(data, entity),
        entity,
        time: typeof data.time === 'string' ? data.time : null,
      },
    }
  },

  outputs: {
    record: {
      type: 'json',
      description: 'Created entity-specific QuickBooks record',
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
