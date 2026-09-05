import { ErrorExtractorId } from '@/tools/error-extractors'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  QuickBooksItem,
  QuickBooksMutationResponse,
  QuickBooksUpdateItemParams,
} from '@/tools/quickbooks/types'
import { QUICKBOOKS_ITEM_PROPERTIES, QUICKBOOKS_MUTATION_OUTPUTS } from '@/tools/quickbooks/types'
import type { InternalToolConfig } from '@/tools/types'

export const quickbooksUpdateItemTool: InternalToolConfig<
  QuickBooksUpdateItemParams,
  QuickBooksMutationResponse<QuickBooksItem>
> = {
  id: 'quickbooks_update_item',
  name: 'QuickBooks Update Item',
  description: 'Read, merge, and full-update an item without changing its type',
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
    itemId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the item to update',
    },
    syncToken: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Current item sync token',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement item name',
    },
    incomeAccountId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement income account ID',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement sales description',
    },
    unitPrice: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement sales price per unit',
    },
    purchaseDescription: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement purchase description',
    },
    purchaseCost: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement purchase cost per unit',
    },
    expenseAccountId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement expense account ID',
    },
    taxable: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the item is taxable',
    },
    activeStatus: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      default: 'unchanged',
      description: 'Item status change: unchanged, active, or inactive',
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
      description: 'Updated QuickBooks Item record',
      properties: QUICKBOOKS_ITEM_PROPERTIES,
    },
    ...QUICKBOOKS_MUTATION_OUTPUTS,
  },
}
