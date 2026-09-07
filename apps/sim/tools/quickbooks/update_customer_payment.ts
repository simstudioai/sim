import { ErrorExtractorId } from '@/tools/error-extractors'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  QuickBooksMutationResponse,
  QuickBooksSalesTransaction,
  QuickBooksUpdateCustomerPaymentParams,
} from '@/tools/quickbooks/types'
import {
  QUICKBOOKS_MUTATION_OUTPUTS,
  QUICKBOOKS_SALES_TRANSACTION_PROPERTIES,
} from '@/tools/quickbooks/types'
import type { InternalToolConfig } from '@/tools/types'

export const quickbooksUpdateCustomerPaymentTool: InternalToolConfig<
  QuickBooksUpdateCustomerPaymentParams,
  QuickBooksMutationResponse<QuickBooksSalesTransaction>
> = {
  id: 'quickbooks_update_customer_payment',
  name: 'QuickBooks Update Customer Payment',
  description: 'Read, merge, and full-update a customer payment using its current sync token',
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
    paymentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Payment ID to update',
    },
    syncToken: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Current payment sync token',
    },
    customerId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement customer ID',
    },
    totalAmount: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement positive payment total',
    },
    transactionDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement payment date in YYYY-MM-DD format',
    },
    privateNote: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement internal note',
    },
    paymentReferenceNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement payment reference number',
    },
    paymentMethodId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement payment method ID',
    },
    depositAccountId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement deposit account ID',
    },
    invoiceAllocations: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Bounded invoice allocations to apply. Each entry sets the amount applied to that invoice; invoices already applied on the payment and not listed here keep their current amounts',
    },
    unapplyOmittedInvoices: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description:
        'Replace the payment allocations outright. Requires a non-empty invoiceAllocations list; every invoice not listed is UNAPPLIED and returns to open',
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
      description: 'Updated native QuickBooks Payment',
      properties: QUICKBOOKS_SALES_TRANSACTION_PROPERTIES,
    },
    ...QUICKBOOKS_MUTATION_OUTPUTS,
  },
}
