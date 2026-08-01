import { ErrorExtractorId } from '@/tools/error-extractors'
import { QUICKBOOKS_MAX_RESPONSE_BYTES } from '@/tools/quickbooks/client'
import { buildQuickBooksCreateBillPaymentBody } from '@/tools/quickbooks/purchasing_utils'
import type {
  QuickBooksCreateBillPaymentParams,
  QuickBooksMutationResponse,
  QuickBooksPurchasingTransaction,
} from '@/tools/quickbooks/types'
import {
  QUICKBOOKS_MUTATION_OUTPUTS,
  QUICKBOOKS_PURCHASING_TRANSACTION_PROPERTIES,
} from '@/tools/quickbooks/types'
import {
  addQuickBooksRequestId,
  buildQuickBooksEntityUrl,
  getQuickBooksToolHeaders,
  transformQuickBooksMutationResponse,
} from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

export const quickbooksCreateBillPaymentTool: ToolConfig<
  QuickBooksCreateBillPaymentParams,
  QuickBooksMutationResponse<QuickBooksPurchasingTransaction>
> = {
  id: 'quickbooks_create_bill_payment',
  name: 'QuickBooks Create Bill Payment',
  description: 'Record a check or credit-card payment allocated to one or more bills',
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
    vendorId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Vendor whose bills are being paid',
    },
    totalAmount: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Positive total payment amount',
    },
    paymentType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Check or credit-card payment type',
    },
    paymentAccountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Bank or credit-card account ID matching the payment type',
    },
    billAllocations: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Bounded Bill ID and amount allocations that equal totalAmount',
    },
    transactionDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Payment date in YYYY-MM-DD format',
    },
    privateNote: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Internal payment note',
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
    requiredScopes: ['com.intuit.quickbooks.accounting'],
  },
  errorExtractor: ErrorExtractorId.QUICKBOOKS_FAULT,
  request: {
    url: (p) =>
      addQuickBooksRequestId(
        buildQuickBooksEntityUrl(p.realmId, 'billpayment'),
        p.requestId
      ).toString(),
    method: 'POST',
    headers: (p) => getQuickBooksToolHeaders(p.accessToken, 'application/json'),
    body: buildQuickBooksCreateBillPaymentBody,
    retry: { enabled: false },
    maxResponseBytes: QUICKBOOKS_MAX_RESPONSE_BYTES,
  },
  transformResponse: (r) =>
    transformQuickBooksMutationResponse<QuickBooksPurchasingTransaction>(r, 'BillPayment'),
  outputs: {
    record: {
      type: 'json',
      description: 'Created native QuickBooks BillPayment',
      properties: QUICKBOOKS_PURCHASING_TRANSACTION_PROPERTIES,
    },
    ...QUICKBOOKS_MUTATION_OUTPUTS,
  },
}
