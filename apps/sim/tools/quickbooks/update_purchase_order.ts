import { ErrorExtractorId } from '@/tools/error-extractors'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  QuickBooksMutationResponse,
  QuickBooksPurchasingTransaction,
  QuickBooksUpdatePurchaseOrderParams,
} from '@/tools/quickbooks/types'
import {
  QUICKBOOKS_MUTATION_OUTPUTS,
  QUICKBOOKS_PURCHASING_TRANSACTION_PROPERTIES,
} from '@/tools/quickbooks/types'
import type { InternalToolConfig } from '@/tools/types'

export const quickbooksUpdatePurchaseOrderTool: InternalToolConfig<
  QuickBooksUpdatePurchaseOrderParams,
  QuickBooksMutationResponse<QuickBooksPurchasingTransaction>
> = {
  id: 'quickbooks_update_purchase_order',
  name: 'QuickBooks Update Purchase Order',
  description: 'Read, merge, and full-update purchase-order header fields',
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
    purchaseOrderId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Purchase Order ID to update',
    },
    syncToken: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Current purchase-order sync token',
    },
    vendorId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement vendor ID',
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
      description: 'Replacement date in YYYY-MM-DD format',
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
      description: 'Replacement purchase-order number',
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
      description: 'Updated native QuickBooks PurchaseOrder',
      properties: QUICKBOOKS_PURCHASING_TRANSACTION_PROPERTIES,
    },
    ...QUICKBOOKS_MUTATION_OUTPUTS,
  },
}
