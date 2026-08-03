import { filterUndefined } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { QUICKBOOKS_MAX_RESPONSE_BYTES } from '@/tools/quickbooks/client'
import type {
  QuickBooksCreateItemParams,
  QuickBooksItem,
  QuickBooksMutationResponse,
} from '@/tools/quickbooks/types'
import { QUICKBOOKS_ITEM_PROPERTIES, QUICKBOOKS_MUTATION_OUTPUTS } from '@/tools/quickbooks/types'
import {
  addQuickBooksRequestId,
  buildQuickBooksEntityUrl,
  getQuickBooksToolHeaders,
  optionalQuickBooksString,
  quickBooksReference,
  quickBooksWritableItemType,
  requiredQuickBooksString,
  transformQuickBooksMutationResponse,
  validateQuickBooksOptionalNumber,
} from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

export const quickbooksCreateItemTool: ToolConfig<
  QuickBooksCreateItemParams,
  QuickBooksMutationResponse<QuickBooksItem>
> = {
  id: 'quickbooks_create_item',
  name: 'QuickBooks Create Item',
  description: 'Create a Service or Non-inventory item in QuickBooks Online',
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
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique item name',
    },
    itemType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Writable item type: service or non_inventory',
    },
    incomeAccountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Income account ID used when the item is sold',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sales description',
    },
    unitPrice: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sales price per unit',
    },
    purchaseDescription: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Purchase description',
    },
    purchaseCost: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Purchase cost per unit',
    },
    expenseAccountId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Expense account ID used when the item is purchased',
    },
    taxable: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the item is taxable',
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
    url: (params) =>
      addQuickBooksRequestId(
        buildQuickBooksEntityUrl(params.realmId, 'item'),
        params.requestId
      ).toString(),
    method: 'POST',
    headers: (params) => getQuickBooksToolHeaders(params.accessToken, 'application/json'),
    body: (params) => {
      const type = quickBooksWritableItemType(params.itemType)
      const purchaseDescription = optionalQuickBooksString(params.purchaseDescription)
      const purchaseCost = validateQuickBooksOptionalNumber(params.purchaseCost, 'purchaseCost')
      if (
        (purchaseDescription !== undefined || purchaseCost !== undefined) &&
        !params.expenseAccountId?.trim()
      ) {
        throw new Error('expenseAccountId is required when purchase fields are supplied')
      }
      return filterUndefined({
        Name: requiredQuickBooksString(params.name, 'name'),
        Type: type,
        IncomeAccountRef: quickBooksReference(params.incomeAccountId, 'incomeAccountId'),
        Description: optionalQuickBooksString(params.description),
        UnitPrice: validateQuickBooksOptionalNumber(params.unitPrice, 'unitPrice'),
        PurchaseDesc: purchaseDescription,
        PurchaseCost: purchaseCost,
        ExpenseAccountRef: params.expenseAccountId
          ? quickBooksReference(params.expenseAccountId, 'expenseAccountId')
          : undefined,
        Taxable: params.taxable,
      })
    },
    retry: { enabled: false },
    maxResponseBytes: QUICKBOOKS_MAX_RESPONSE_BYTES,
  },
  transformResponse: (response) =>
    transformQuickBooksMutationResponse<QuickBooksItem>(response, 'Item'),
  outputs: {
    record: {
      type: 'json',
      description: 'Created QuickBooks Item record',
      properties: QUICKBOOKS_ITEM_PROPERTIES,
    },
    ...QUICKBOOKS_MUTATION_OUTPUTS,
  },
}
