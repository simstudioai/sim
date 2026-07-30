import { QUICKBOOKS_MAX_RESPONSE_BYTES } from '@/lib/quickbooks/client'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  QuickBooksBill,
  QuickBooksListResponse,
  QuickBooksPaginationParams,
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

export const quickbooksListBillsTool: ToolConfig<
  QuickBooksPaginationParams,
  QuickBooksListResponse<QuickBooksBill>
> = {
  id: 'quickbooks_list_bills',
  name: 'QuickBooks List Bills',
  description: 'List bills in the connected QuickBooks Online company',
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
      description: 'One-based position of the first bill to return',
    },
    maxResults: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      default: 25,
      description: 'Number of bills to request (1–100)',
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
        'Bill',
        params.startPosition,
        params.maxResults
      ).toString(),
    method: 'GET',
    headers: (params) => getQuickBooksToolHeaders(params.accessToken),
    retry: { enabled: false },
    maxResponseBytes: QUICKBOOKS_MAX_RESPONSE_BYTES,
  },
  transformResponse: (response, params) =>
    transformQuickBooksListResponse<QuickBooksBill>(response, params!, 'Bill'),
  outputs: {
    items: {
      type: 'array',
      description: 'Bill objects returned by QuickBooks',
      items: {
        type: 'json',
        properties: {
          Id: { type: 'string', description: 'Bill ID' },
          SyncToken: { type: 'string', description: 'Bill sync token', optional: true },
          DocNumber: { type: 'string', description: 'Bill reference number', optional: true },
          TxnDate: { type: 'string', description: 'Bill transaction date', optional: true },
          DueDate: { type: 'string', description: 'Bill due date', optional: true },
          VendorRef: {
            type: 'json',
            description: 'Bill vendor reference',
            optional: true,
            properties: QUICKBOOKS_REFERENCE_PROPERTIES,
          },
          APAccountRef: {
            type: 'json',
            description: 'Accounts payable account reference',
            optional: true,
            properties: QUICKBOOKS_REFERENCE_PROPERTIES,
          },
          CurrencyRef: {
            type: 'json',
            description: 'Bill currency reference',
            optional: true,
            properties: QUICKBOOKS_REFERENCE_PROPERTIES,
          },
          ExchangeRate: { type: 'number', description: 'Bill exchange rate', optional: true },
          Line: {
            type: 'array',
            description: 'Bill line items and their detail objects',
            optional: true,
            items: { type: 'json' },
          },
          TotalAmt: { type: 'number', description: 'Bill total amount', optional: true },
          Balance: { type: 'number', description: 'Unpaid bill balance', optional: true },
          PrivateNote: { type: 'string', description: 'Private bill note', optional: true },
          MetaData: {
            type: 'json',
            description: 'Bill creation and update timestamps',
            optional: true,
            properties: QUICKBOOKS_METADATA_PROPERTIES,
          },
        },
      },
    },
    ...QUICKBOOKS_LIST_OUTPUTS,
  },
}
