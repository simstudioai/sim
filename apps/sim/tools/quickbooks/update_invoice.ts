import { ErrorExtractorId } from '@/tools/error-extractors'
import { buildQuickBooksUpdateSalesDocumentBody } from '@/tools/quickbooks/sales_utils'
import type {
  QuickBooksMutationResponse,
  QuickBooksSalesTransaction,
  QuickBooksUpdateInvoiceParams,
} from '@/tools/quickbooks/types'
import {
  QUICKBOOKS_MUTATION_OUTPUTS,
  QUICKBOOKS_SALES_TRANSACTION_PROPERTIES,
} from '@/tools/quickbooks/types'
import {
  buildQuickBooksEntityUrl,
  getQuickBooksToolHeaders,
  transformQuickBooksMutationResponse,
} from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

export const quickbooksUpdateInvoiceTool: ToolConfig<
  QuickBooksUpdateInvoiceParams,
  QuickBooksMutationResponse<QuickBooksSalesTransaction>
> = {
  id: 'quickbooks_update_invoice',
  name: 'QuickBooks Update Invoice',
  description: 'Sparse-update an invoice using its current sync token',
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
    quickBooksEnvironment: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'QuickBooks API environment derived from the connected credential',
    },
    transactionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Invoice ID to update',
    },
    syncToken: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Current invoice sync token',
    },
    customerId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement customer ID',
    },
    lines: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Complete replacement set of invoice lines: any existing line omitted here is deleted from the invoice',
    },
    transactionDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement invoice date in YYYY-MM-DD format',
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
      description: 'Replacement invoice number',
    },
    privateNote: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement internal note',
    },
    customerMemo: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement customer-facing memo',
    },
  },
  oauth: {
    required: true,
    provider: 'quickbooks',
    authoritativeParams: ['realmId', 'quickBooksEnvironment'],
    requiredScopes: ['com.intuit.quickbooks.accounting'],
  },
  errorExtractor: ErrorExtractorId.QUICKBOOKS_FAULT,
  request: {
    url: (params) => buildQuickBooksEntityUrl(params, 'invoice').toString(),
    method: 'POST',
    headers: (params) => getQuickBooksToolHeaders(params.accessToken, 'application/json'),
    body: (params) => buildQuickBooksUpdateSalesDocumentBody(params),
    retry: { enabled: false },
  },
  transformResponse: (response) =>
    transformQuickBooksMutationResponse<QuickBooksSalesTransaction>(response, 'Invoice'),
  outputs: {
    record: {
      type: 'json',
      description: 'Updated native QuickBooks Invoice',
      properties: QUICKBOOKS_SALES_TRANSACTION_PROPERTIES,
    },
    ...QUICKBOOKS_MUTATION_OUTPUTS,
  },
}
