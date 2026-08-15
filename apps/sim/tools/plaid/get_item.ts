import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PlaidGetItemParams, PlaidGetItemResponse } from '@/tools/plaid/types'
import {
  buildPlaidHeaders,
  mapPlaidItem,
  mapPlaidItemStatus,
  plaidAccessTokenParamField,
  plaidBaseParamFields,
  plaidRecord,
  plaidUrl,
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
    body: (params) => ({ access_token: params.accessToken.trim() }),
  },

  transformResponse: async (response) => {
    const data = await plaidRecord(response, 'item')
    return {
      success: true,
      output: {
        item: mapPlaidItem(data.item),
        status: mapPlaidItemStatus(data.status),
      },
    }
  },

  outputs: {
    item: {
      type: 'json',
      description: 'Item metadata',
      properties: {
        item_id: { type: 'string', description: 'Unique ID of the Item' },
        institution_id: {
          type: 'string',
          description: 'Plaid institution ID the Item is linked to',
          optional: true,
        },
        institution_name: {
          type: 'string',
          description: 'Name of the linked institution',
          optional: true,
        },
        webhook: { type: 'string', description: 'Webhook URL set on the Item', optional: true },
        error: {
          type: 'json',
          description: 'Error state of the Item, null when healthy',
          optional: true,
        },
        available_products: {
          type: 'json',
          description: 'Products available but not yet billed for the Item',
        },
        billed_products: { type: 'json', description: 'Products the Item has been billed for' },
        products: { type: 'json', description: 'All products enabled on the Item' },
        consent_expiration_time: {
          type: 'string',
          description: 'When access consent expires, if the institution enforces expiration',
          optional: true,
        },
        update_type: {
          type: 'string',
          description: 'Item update type (background or user_present_required)',
        },
        created_at: { type: 'string', description: 'When the Item was created' },
      },
    },
    status: {
      type: 'json',
      description:
        'Item health: last successful/failed transaction and investment updates and the last webhook fired',
      optional: true,
    },
  },
}
