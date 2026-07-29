import type { QuickBooksListParams, QuickBooksQueryResponse } from '@/tools/quickbooks/types'
import {
  buildQuickBooksHeaders,
  buildQuickBooksListQuery,
  buildQuickBooksQueryUrl,
  extractQuickBooksRecords,
  getQuickBooksQueryMetadata,
  parseQuickBooksJson,
} from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

export const quickBooksListVendorsTool: ToolConfig<QuickBooksListParams, QuickBooksQueryResponse> =
  {
    id: 'quickbooks_list_vendors',
    name: 'QuickBooks List Vendors',
    description: 'List vendors from QuickBooks Online',
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
        visibility: 'user-or-llm',
        description: 'QuickBooks company ID returned by Intuit as realmId during OAuth',
      },
      activeOnly: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Only return active vendors',
      },
      startPosition: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'One-based start position for QuickBooks query pagination',
      },
      maxResults: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Maximum number of vendors to return, up to 1000',
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
        buildQuickBooksQueryUrl({
          realmId: params.realmId,
          query: buildQuickBooksListQuery('Vendor', params),
          minorVersion: params.minorVersion,
        }),
      method: 'GET',
      headers: (params) => buildQuickBooksHeaders(params.accessToken),
    },

    transformResponse: async (response, params) => {
      const data = await parseQuickBooksJson(response)
      const { entity, items } = extractQuickBooksRecords(data, 'Vendor')
      const metadata = getQuickBooksQueryMetadata(data)

      return {
        success: true,
        output: {
          items,
          entity,
          totalCount: metadata.totalCount,
          startPosition: metadata.startPosition,
          maxResults: metadata.maxResults,
          query: buildQuickBooksListQuery('Vendor', params ?? { accessToken: '', realmId: '' }),
        },
      }
    },

    outputs: {
      items: {
        type: 'array',
        description: 'Vendors returned by QuickBooks',
        items: {
          type: 'json',
          properties: {
            Id: { type: 'string', description: 'QuickBooks vendor ID', optional: true },
            DisplayName: { type: 'string', description: 'Vendor display name', optional: true },
            Active: {
              type: 'boolean',
              description: 'Whether the vendor is active',
              optional: true,
            },
          },
        },
      },
      entity: { type: 'string', description: 'QuickBooks entity name' },
      totalCount: {
        type: 'number',
        description: 'Total count returned by QuickBooks',
        optional: true,
      },
      startPosition: {
        type: 'number',
        description: 'Start position returned by QuickBooks',
        optional: true,
      },
      maxResults: {
        type: 'number',
        description: 'Maximum records returned by QuickBooks',
        optional: true,
      },
      query: { type: 'string', description: 'Query that was executed' },
    },
  }
