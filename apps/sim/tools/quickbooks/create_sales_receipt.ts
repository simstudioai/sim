import { ErrorExtractorId } from '@/tools/error-extractors'
import { buildQuickBooksCreateSalesDocumentBody } from '@/tools/quickbooks/sales_utils'
import type {
  QuickBooksCreateSalesReceiptParams,
  QuickBooksMutationResponse,
  QuickBooksSalesTransaction,
} from '@/tools/quickbooks/types'
import {
  QUICKBOOKS_MUTATION_OUTPUTS,
  QUICKBOOKS_SALES_TRANSACTION_PROPERTIES,
} from '@/tools/quickbooks/types'
import {
  addQuickBooksRequestId,
  buildQuickBooksEntityUrl,
  getQuickBooksToolHeaders,
  transformQuickBooksMutationResponse,
} from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

export const quickbooksCreateSalesReceiptTool: ToolConfig<
  QuickBooksCreateSalesReceiptParams,
  QuickBooksMutationResponse<QuickBooksSalesTransaction>
> = {
  id: 'quickbooks_create_sales_receipt',
  name: 'QuickBooks Create Sales Receipt',
  description: 'Create a sales receipt for a completed customer sale',
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
    customerId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Customer for the sales receipt, omitted for an anonymous sale',
    },
    lines: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Bounded item and description lines',
    },
    transactionDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sales receipt date in YYYY-MM-DD format',
    },
    documentNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional sales receipt number',
    },
    privateNote: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Internal sales receipt note',
    },
    customerMemo: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Customer-facing sales receipt memo',
    },
    paymentMethodId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'QuickBooks payment method ID',
    },
    paymentReferenceNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Payment reference number',
    },
    depositAccountId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'QuickBooks deposit account ID',
    },
    requestId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional Intuit idempotency request ID, up to 50 characters',
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
    url: (params) =>
      addQuickBooksRequestId(
        buildQuickBooksEntityUrl(params, 'salesreceipt'),
        params.requestId
      ).toString(),
    method: 'POST',
    headers: (params) => getQuickBooksToolHeaders(params.accessToken, 'application/json'),
    body: (params) => buildQuickBooksCreateSalesDocumentBody(params, { customerOptional: true }),
    retry: { enabled: false },
  },
  transformResponse: (response) =>
    transformQuickBooksMutationResponse<QuickBooksSalesTransaction>(response, 'SalesReceipt'),
  outputs: {
    record: {
      type: 'json',
      description: 'Created native QuickBooks SalesReceipt',
      properties: QUICKBOOKS_SALES_TRANSACTION_PROPERTIES,
    },
    ...QUICKBOOKS_MUTATION_OUTPUTS,
  },
}
