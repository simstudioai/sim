import type {
  QuickBooksRecordResponse,
  QuickBooksUpdateRecordParams,
} from '@/tools/quickbooks/types'
import {
  buildQuickBooksHeaders,
  buildQuickBooksRecordUrl,
  buildQuickBooksUpdateBody,
  extractQuickBooksRecord,
  parseQuickBooksJson,
} from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

export const quickBooksUpdateRecordTool: ToolConfig<
  QuickBooksUpdateRecordParams,
  QuickBooksRecordResponse
> = {
  id: 'quickbooks_update_record',
  name: 'QuickBooks Update Record',
  description: 'Update a supported QuickBooks Online accounting record',
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
      description: 'Updatable QuickBooks entity name',
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
      description: 'Latest QuickBooks SyncToken for the record',
    },
    payload: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Fields to update using the selected entity API schema',
    },
    sparse: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Use a sparse update so omitted fields are preserved. Defaults to true.',
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
        operation: 'update',
      }).url,
    method: 'POST',
    headers: (params) => buildQuickBooksHeaders(params.accessToken),
    body: (params) => buildQuickBooksUpdateBody(params),
  },

  transformResponse: async (response, params) => {
    if (!params) throw new Error('QuickBooks record parameters are required')
    const { entity } = buildQuickBooksRecordUrl({ ...params, operation: 'update' })
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
      description: 'Updated entity-specific QuickBooks record',
    },
    entity: { type: 'string', description: 'QuickBooks entity name' },
    time: {
      type: 'string',
      description: 'QuickBooks response timestamp',
      optional: true,
    },
  },
}
