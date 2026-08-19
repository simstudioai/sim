import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PlaidGetItemParams, PlaidGetItemResponse } from '@/tools/plaid/types'
import {
  buildPlaidInternalBody,
  mapPlaidItem,
  mapPlaidItemStatus,
  plaidBaseParamFields,
  plaidItemOutputProperties,
  plaidItemStatusOutputProperties,
  plaidRecord,
} from '@/tools/plaid/utils'
import type { ToolConfig } from '@/tools/types'

export const plaidGetItemTool: ToolConfig<PlaidGetItemParams, PlaidGetItemResponse> = {
  id: 'plaid_get_item',
  name: 'Plaid Get Item',
  description:
    'Get metadata and health status for a linked Item, including its institution, enabled products, and any error state',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PLAID_ERRORS,

  params: {
    ...plaidBaseParamFields,
  },

  request: {
    url: '/api/tools/plaid',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => buildPlaidInternalBody('plaid_get_item', params, {}),
    internalAuth: 'executor_delegation',
  },

  transformResponse: async (response) => {
    const data = await plaidRecord(response, 'item')
    const status = mapPlaidItemStatus(data.status)
    return {
      success: true,
      output: {
        item: mapPlaidItem(data.item),
        ...(status !== undefined ? { status } : {}),
      },
    }
  },

  outputs: {
    item: {
      type: 'object',
      description: 'Item metadata',
      properties: plaidItemOutputProperties,
    },
    status: {
      type: 'object',
      description:
        'Item health: last successful/failed transaction and investment updates and the last webhook fired',
      optional: true,
      nullable: true,
      properties: plaidItemStatusOutputProperties,
    },
  },
}
