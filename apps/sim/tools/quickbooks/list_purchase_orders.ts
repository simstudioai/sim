import { QUICKBOOKS_MAX_RESPONSE_BYTES } from '@/lib/quickbooks/client'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  QuickBooksListResponse,
  QuickBooksPaginationParams,
  QuickBooksPurchaseOrder,
} from '@/tools/quickbooks/types'
import {
  QUICKBOOKS_LIST_OUTPUTS,
  QUICKBOOKS_METADATA_PROPERTIES,
  QUICKBOOKS_REFERENCE_PROPERTIES,
} from '@/tools/quickbooks/types'
import {
  buildQuickBooksQueryUrl,
  getQuickBooksToolHeaders,
  transformQuickBooksListResponse,
} from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

export const quickbooksListPurchaseOrdersTool: ToolConfig<
  QuickBooksPaginationParams,
  QuickBooksListResponse<QuickBooksPurchaseOrder>
> = {
  id: 'quickbooks_list_purchase_orders',
  name: 'QuickBooks List Purchase Orders',
  description: 'List purchase orders in the connected QuickBooks Online company',
  version: '1.0.0',
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
      description: 'QuickBooks company ID derived from the connected credential',
    },
    startPosition: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      default: 1,
      description: 'One-based position of the first purchase order to return',
    },
    maxResults: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      default: 25,
      description: 'Number of purchase orders to request (1–100)',
    },
  },
  oauth: {
    required: true,
    provider: 'quickbooks',
    requiredScopes: ['com.intuit.quickbooks.accounting'],
  },
  errorExtractor: ErrorExtractorId.QUICKBOOKS_FAULT,
  request: {
    url: (params) =>
      buildQuickBooksQueryUrl(
        params.realmId,
        'PurchaseOrder',
        params.startPosition,
        params.maxResults
      ).toString(),
    method: 'GET',
    headers: (params) => getQuickBooksToolHeaders(params.accessToken),
    retry: { enabled: false },
    maxResponseBytes: QUICKBOOKS_MAX_RESPONSE_BYTES,
  },
  transformResponse: (response, params) =>
    transformQuickBooksListResponse<QuickBooksPurchaseOrder>(response, params!, 'PurchaseOrder'),
  outputs: {
    items: {
      type: 'array',
      description: 'PurchaseOrder objects returned by QuickBooks',
      items: {
        type: 'json',
        properties: {
          Id: { type: 'string', description: 'Purchase order ID' },
          SyncToken: { type: 'string', description: 'Purchase order sync token', optional: true },
          DocNumber: { type: 'string', description: 'Purchase order number', optional: true },
          TxnDate: { type: 'string', description: 'Purchase order date', optional: true },
          VendorRef: {
            type: 'json',
            description: 'Purchase order vendor reference',
            optional: true,
            properties: QUICKBOOKS_REFERENCE_PROPERTIES,
          },
          CurrencyRef: {
            type: 'json',
            description: 'Purchase order currency reference',
            optional: true,
            properties: QUICKBOOKS_REFERENCE_PROPERTIES,
          },
          ExchangeRate: {
            type: 'number',
            description: 'Purchase order exchange rate',
            optional: true,
          },
          Line: {
            type: 'array',
            description: 'Purchase order line items and their detail objects',
            optional: true,
            items: { type: 'json' },
          },
          TotalAmt: {
            type: 'number',
            description: 'Purchase order total amount',
            optional: true,
          },
          PrivateNote: {
            type: 'string',
            description: 'Private purchase order note',
            optional: true,
          },
          MetaData: {
            type: 'json',
            description: 'Purchase order creation and update timestamps',
            optional: true,
            properties: QUICKBOOKS_METADATA_PROPERTIES,
          },
        },
      },
    },
    ...QUICKBOOKS_LIST_OUTPUTS,
  },
}
