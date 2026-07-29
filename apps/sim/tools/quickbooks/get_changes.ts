import type { QuickBooksCdcParams, QuickBooksCdcResponse } from '@/tools/quickbooks/types'
import {
  buildQuickBooksCdcUrl,
  buildQuickBooksHeaders,
  extractQuickBooksCdcChanges,
  parseQuickBooksJson,
  quickBooksCdcMayBeTruncated,
} from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

export const quickBooksGetChangesTool: ToolConfig<QuickBooksCdcParams, QuickBooksCdcResponse> = {
  id: 'quickbooks_get_changes',
  name: 'QuickBooks Get Changes',
  description: 'Get QuickBooks Online records changed during the last 30 days using CDC',
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
    entities: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated QuickBooks entity names to track',
    },
    changedSince: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ISO date or date-time within the last 30 days',
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
    url: (params) => buildQuickBooksCdcUrl(params),
    method: 'GET',
    headers: (params) => buildQuickBooksHeaders(params.accessToken),
  },

  transformResponse: async (response, params) => {
    if (!params) throw new Error('QuickBooks CDC parameters are required')
    const data = await parseQuickBooksJson(response)
    const changes = extractQuickBooksCdcChanges(data)

    return {
      success: true,
      output: {
        changes,
        changedSince: params.changedSince.trim(),
        mayBeTruncated: quickBooksCdcMayBeTruncated(changes),
        time: typeof data.time === 'string' ? data.time : null,
      },
    }
  },

  outputs: {
    changes: {
      type: 'array',
      description: 'Changed QuickBooks records grouped by entity',
      items: {
        type: 'object',
        properties: {
          entity: { type: 'string', description: 'QuickBooks entity name' },
          records: {
            type: 'array',
            description: 'Changed or deleted entity records',
            items: { type: 'json', description: 'Entity-specific QuickBooks record' },
          },
          startPosition: {
            type: 'number',
            description: 'Start position returned by QuickBooks',
            nullable: true,
          },
          maxResults: {
            type: 'number',
            description: 'Maximum results returned by QuickBooks',
            nullable: true,
          },
          totalCount: {
            type: 'number',
            description: 'Total changes returned for the entity',
            nullable: true,
          },
        },
      },
    },
    changedSince: { type: 'string', description: 'Requested change look-back date' },
    mayBeTruncated: {
      type: 'boolean',
      description: 'Whether the 1,000-object CDC response limit may have been reached',
    },
    time: {
      type: 'string',
      description: 'QuickBooks response timestamp',
      optional: true,
    },
  },
}
