import type { QuickBooksBatchParams, QuickBooksBatchResponse } from '@/tools/quickbooks/types'
import {
  buildQuickBooksBatchBody,
  buildQuickBooksBatchUrl,
  buildQuickBooksHeaders,
  parseQuickBooksJson,
} from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

export const quickBooksBatchTool: ToolConfig<QuickBooksBatchParams, QuickBooksBatchResponse> = {
  id: 'quickbooks_batch',
  name: 'QuickBooks Run Batch',
  description: 'Run up to 10 QuickBooks Online entity or query operations in one batch',
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
    batch: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'QuickBooks batch payload containing a BatchItemRequest array',
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
    url: (params) => buildQuickBooksBatchUrl(params),
    method: 'POST',
    headers: (params) => buildQuickBooksHeaders(params.accessToken),
    body: (params) => buildQuickBooksBatchBody(params.batch),
  },

  transformResponse: async (response) => {
    const data = await parseQuickBooksJson(response)
    return {
      success: true,
      output: {
        batchItems: Array.isArray(data.BatchItemResponse) ? data.BatchItemResponse : [],
        time: typeof data.time === 'string' ? data.time : null,
      },
    }
  },

  outputs: {
    batchItems: {
      type: 'array',
      description: 'QuickBooks batch item responses in request order',
      items: {
        type: 'json',
        description: 'Entity, query, report, or fault response identified by bId',
      },
    },
    time: {
      type: 'string',
      description: 'QuickBooks response timestamp',
      optional: true,
    },
  },
}
