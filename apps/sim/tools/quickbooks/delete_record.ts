import type {
  QuickBooksDeleteRecordParams,
  QuickBooksRecordResponse,
} from '@/tools/quickbooks/types'
import {
  buildQuickBooksDeleteBody,
  buildQuickBooksHeaders,
  buildQuickBooksRecordUrl,
  extractQuickBooksRecord,
  parseQuickBooksJson,
} from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

export const quickBooksDeleteRecordTool: ToolConfig<
  QuickBooksDeleteRecordParams,
  QuickBooksRecordResponse
> = {
  id: 'quickbooks_delete_record',
  name: 'QuickBooks Delete Record',
  description: 'Delete a supported QuickBooks Online transaction or attachment',
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
      description: 'QuickBooks entity that supports hard delete',
    },
    recordId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'QuickBooks record ID',
    },
    syncToken: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Latest QuickBooks SyncToken for the transaction',
    },
    payload: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Full entity payload when the selected transaction does not support simplified delete',
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
        operation: 'delete',
      }).url,
    method: 'POST',
    headers: (params) => buildQuickBooksHeaders(params.accessToken),
    body: (params) => buildQuickBooksDeleteBody(params),
  },

  transformResponse: async (response, params) => {
    if (!params) throw new Error('QuickBooks record parameters are required')
    const { entity } = buildQuickBooksRecordUrl({ ...params, operation: 'delete' })
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
      description: 'Deleted entity-specific QuickBooks record',
    },
    entity: { type: 'string', description: 'QuickBooks entity name' },
    time: {
      type: 'string',
      description: 'QuickBooks response timestamp',
      optional: true,
    },
  },
}
