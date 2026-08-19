import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PlaidGetItemParams, PlaidGetItemResponse } from '@/tools/plaid/types'
import {
  buildPlaidHeaders,
  mapPlaidItem,
  mapPlaidItemStatus,
  plaidAccessTokenParamField,
  plaidBaseParamFields,
  plaidItemOutputProperties,
  plaidItemStatusOutputProperties,
  plaidRecord,
  plaidUrl,
  requirePlaidInputString,
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
    ...plaidAccessTokenParamField,
  },

  request: {
    url: (params) => plaidUrl(params, '/item/get'),
    method: 'POST',
    headers: (params) => buildPlaidHeaders(params),
    body: (params) => ({
      access_token: requirePlaidInputString(params.accessToken, 'accessToken'),
    }),
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
