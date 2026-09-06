import { filterUndefined } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
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
  transformQuickBooksMutationResponse,
} from '@/tools/quickbooks/utils'
import {
  optionalQuickBooksString,
  quickBooksItemName,
  quickBooksReference,
  quickBooksWritableItemType,
  requiredQuickBooksString,
  validateQuickBooksOptionalNumber,
} from '@/tools/quickbooks/values'
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
    quickBooksEnvironment: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'QuickBooks API environment derived from the connected credential',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique item name, up to 100 characters, without tabs, new lines, or colons',
    },
    itemType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Writable item type: service or non_inventory',
    },
    incomeAccountId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Sales of Product Income account ID recording proceeds from the sale. Intuit requires it for Service items except in France locales',
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
      description:
        'Cost of Goods Sold account ID used to pay the vendor for this item. Intuit requires it for Service and Non-inventory items except in France locales',
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
    authoritativeParams: ['realmId', 'quickBooksEnvironment'],
    requiredScopes: ['com.intuit.quickbooks.accounting'],
  },
  errorExtractor: ErrorExtractorId.QUICKBOOKS_FAULT,
  request: {
    url: (params) =>
      addQuickBooksRequestId(buildQuickBooksEntityUrl(params, 'item'), params.requestId).toString(),
    method: 'POST',
    headers: (params) => getQuickBooksToolHeaders(params.accessToken, 'application/json'),
    body: (params) => {
      const type = quickBooksWritableItemType(params.itemType)
      const incomeAccountId = optionalQuickBooksString(params.incomeAccountId)
      const expenseAccountId = optionalQuickBooksString(params.expenseAccountId)
      return filterUndefined({
        Name: quickBooksItemName(requiredQuickBooksString(params.name, 'name')),
        Type: type,
        IncomeAccountRef:
          incomeAccountId === undefined
            ? undefined
            : quickBooksReference(incomeAccountId, 'incomeAccountId'),
        Description: optionalQuickBooksString(params.description),
        UnitPrice: validateQuickBooksOptionalNumber(params.unitPrice, 'unitPrice'),
        PurchaseDesc: optionalQuickBooksString(params.purchaseDescription),
        PurchaseCost: validateQuickBooksOptionalNumber(params.purchaseCost, 'purchaseCost'),
        ExpenseAccountRef:
          expenseAccountId === undefined
            ? undefined
            : quickBooksReference(expenseAccountId, 'expenseAccountId'),
        Taxable: params.taxable,
      })
    },
    retry: { enabled: false },
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
