import { ErrorExtractorId } from '@/tools/error-extractors'
import { buildQuickBooksUpdateBillBody } from '@/tools/quickbooks/purchasing_utils'
import type {
  QuickBooksMutationResponse,
  QuickBooksPurchasingTransaction,
  QuickBooksUpdateBillParams,
} from '@/tools/quickbooks/types'
import {
  QUICKBOOKS_MUTATION_OUTPUTS,
  QUICKBOOKS_PURCHASING_TRANSACTION_PROPERTIES,
} from '@/tools/quickbooks/types'
import {
  buildQuickBooksEntityUrl,
  getQuickBooksToolHeaders,
  transformQuickBooksMutationResponse,
} from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

export const quickbooksUpdateBillTool: ToolConfig<
  QuickBooksUpdateBillParams,
  QuickBooksMutationResponse<QuickBooksPurchasingTransaction>
> = {
  id: 'quickbooks_update_bill',
  name: 'QuickBooks Update Bill',
  description: 'Sparse-update bill header fields using its vendor and current sync token',
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
    billId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Bill ID to update',
    },
    syncToken: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Current bill sync token',
    },
    vendorId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Current or replacement vendor ID required by QuickBooks',
    },
    apAccountId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement accounts-payable account ID',
    },
    transactionDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement bill date in YYYY-MM-DD format',
    },
    dueDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement due date in YYYY-MM-DD format',
    },
    documentNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement bill number',
    },
    privateNote: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement internal note',
    },
  },
  oauth: {
    required: true,
    provider: 'quickbooks',
    requiredScopes: ['com.intuit.quickbooks.accounting'],
  },
  errorExtractor: ErrorExtractorId.QUICKBOOKS_FAULT,
  request: {
    url: (p) => buildQuickBooksEntityUrl(p.realmId, 'bill').toString(),
    method: 'POST',
    headers: (p) => getQuickBooksToolHeaders(p.accessToken, 'application/json'),
    body: buildQuickBooksUpdateBillBody,
    retry: { enabled: false },
  },
  transformResponse: (r) =>
    transformQuickBooksMutationResponse<QuickBooksPurchasingTransaction>(r, 'Bill'),
  outputs: {
    record: {
      type: 'json',
      description: 'Updated native QuickBooks Bill',
      properties: QUICKBOOKS_PURCHASING_TRANSACTION_PROPERTIES,
    },
    ...QUICKBOOKS_MUTATION_OUTPUTS,
  },
}
