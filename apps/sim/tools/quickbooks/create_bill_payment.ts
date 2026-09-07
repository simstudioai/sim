import { ErrorExtractorId } from '@/tools/error-extractors'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  QuickBooksCreateBillPaymentParams,
  QuickBooksMutationResponse,
  QuickBooksPurchasingTransaction,
} from '@/tools/quickbooks/types'
import {
  QUICKBOOKS_MUTATION_OUTPUTS,
  QUICKBOOKS_PURCHASING_TRANSACTION_PROPERTIES,
} from '@/tools/quickbooks/types'
import type { InternalToolConfig } from '@/tools/types'

export const quickbooksCreateBillPaymentTool: InternalToolConfig<
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
    quickBooksEnvironment: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'QuickBooks API environment derived from the connected credential',
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
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional bounded Bill-only allocations; any unallocated amount becomes vendor credit',
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
    apAccountId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional accounts-payable account the payment is credited to',
    },
    documentNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional reference number for the payment',
    },
    currencyCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Three-letter ISO 4217 currency code, required when multicurrency is enabled for the company',
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
  operation: {
    input: createInternalToolOperationInput,
  },
  outputs: {
    record: {
      type: 'json',
      description: 'Created native QuickBooks BillPayment',
      properties: QUICKBOOKS_PURCHASING_TRANSACTION_PROPERTIES,
    },
    ...QUICKBOOKS_MUTATION_OUTPUTS,
  },
}
