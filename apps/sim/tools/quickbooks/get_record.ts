import type { QuickBooksGetRecordParams, QuickBooksRecordResponse } from '@/tools/quickbooks/types'
import {
  buildQuickBooksHeaders,
  buildQuickBooksRecordUrl,
  extractQuickBooksRecord,
  parseQuickBooksJson,
} from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

export const quickBooksGetRecordTool: ToolConfig<
  QuickBooksGetRecordParams,
  QuickBooksRecordResponse
> = {
  id: 'quickbooks_get_record',
  name: 'QuickBooks Get Record',
  description: 'Get a QuickBooks Online accounting record by entity and ID',
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
      description: 'Readable QuickBooks entity name',
    },
    recordId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'QuickBooks record ID',
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
        operation: 'read',
      }).url,
    method: 'GET',
    headers: (params) => buildQuickBooksHeaders(params.accessToken),
  },

  transformResponse: async (response, params) => {
    if (!params) throw new Error('QuickBooks record parameters are required')
    const { entity } = buildQuickBooksRecordUrl({ ...params, operation: 'read' })
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
      description: 'Entity-specific QuickBooks record',
    },
    entity: { type: 'string', description: 'QuickBooks entity name' },
    time: {
      type: 'string',
      description: 'QuickBooks response timestamp',
      optional: true,
    },
  },
}
