import { createLogger } from '@sim/logger'
import type { QuickBooksCreateItemParams, QuickBooksItemResponse } from '@/tools/quickbooks/types'
import { ITEM_OUTPUT } from '@/tools/quickbooks/types'
import { buildCompanyUrl, quickbooksAuthHeaders } from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('QuickBooksCreateItem')

const SUPPORTED_TYPES = new Set(['Service', 'NonInventory'])

export const quickbooksCreateItemTool: ToolConfig<
  QuickBooksCreateItemParams,
  QuickBooksItemResponse
> = {
  id: 'quickbooks_create_item',
  name: 'QuickBooks Create Item',
  description: 'Create a new item (product or service) in QuickBooks Online',
  version: '1.0.0',

  oauth: { required: true, provider: 'quickbooks' },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'QuickBooks OAuth access token',
    },
    realmId: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'QuickBooks company ID (realmId) — captured at OAuth time',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Item name (must be unique within the company)',
    },
    type: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Item type — Service or NonInventory (Inventory not supported in MVP)',
    },
    incomeAccountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Income account ID to associate with the item',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Item description',
    },
    unitPrice: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Unit price for the item',
    },
  },

  request: {
    url: (params) => `${buildCompanyUrl(params.realmId, '/item')}?minorversion=73`,
    method: 'POST',
    headers: (params) => quickbooksAuthHeaders(params.accessToken),
    body: (params) => {
      if (!SUPPORTED_TYPES.has(params.type)) {
        throw new Error(
          `QuickBooks item type '${params.type}' is not supported. Use 'Service' or 'NonInventory'. Inventory items require additional fields and are not supported in MVP.`
        )
      }
      const body: Record<string, unknown> = {
        Name: params.name,
        Type: params.type,
        IncomeAccountRef: { value: params.incomeAccountId },
      }
      if (params.description) body.Description = params.description
      if (params.unitPrice !== undefined && params.unitPrice !== null) {
        body.UnitPrice = Number(params.unitPrice)
      }
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('QuickBooks create item failed', { status: response.status, data })
      throw new Error(data?.Fault?.Error?.[0]?.Message || 'Failed to create QuickBooks item')
    }
    const item = (data?.Item ?? null) as Record<string, unknown> | null
    return {
      success: true,
      output: {
        item,
        itemId: item ? ((item.Id as string) ?? null) : null,
      },
    }
  },

  outputs: {
    item: { type: 'object', description: 'Created item', properties: ITEM_OUTPUT },
    itemId: { type: 'string', description: 'New item ID' },
  },
}
