import { filterUndefined } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { QUICKBOOKS_MAX_RESPONSE_BYTES } from '@/tools/quickbooks/client'
import type {
  QuickBooksItem,
  QuickBooksMutationResponse,
  QuickBooksUpdateItemParams,
} from '@/tools/quickbooks/types'
import { QUICKBOOKS_ITEM_PROPERTIES, QUICKBOOKS_MUTATION_OUTPUTS } from '@/tools/quickbooks/types'
import {
  buildQuickBooksEntityUrl,
  getQuickBooksToolHeaders,
  transformQuickBooksMutationResponse,
} from '@/tools/quickbooks/utils'
import {
  assertQuickBooksSparseUpdate,
  optionalQuickBooksString,
  quickBooksActiveValue,
  quickBooksReference,
  requiredQuickBooksString,
  validateQuickBooksOptionalNumber,
} from '@/tools/quickbooks/values'
import type { ToolConfig } from '@/tools/types'

export const quickbooksUpdateItemTool: ToolConfig<
  QuickBooksUpdateItemParams,
  QuickBooksMutationResponse<QuickBooksItem>
> = {
  id: 'quickbooks_update_item',
  name: 'QuickBooks Update Item',
  description: 'Sparse-update supported fields on an item without changing its type',
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
    requiredScopes: ['com.intuit.quickbooks.accounting'],
  },
  errorExtractor: ErrorExtractorId.QUICKBOOKS_FAULT,
  request: {
    url: (params) => buildQuickBooksEntityUrl(params.realmId, 'item').toString(),
    method: 'POST',
    headers: (params) => getQuickBooksToolHeaders(params.accessToken, 'application/json'),
    body: (params) => {
      const body = filterUndefined({
        Id: requiredQuickBooksString(params.itemId, 'itemId'),
        SyncToken: requiredQuickBooksString(params.syncToken, 'syncToken'),
        sparse: true,
        Name: optionalQuickBooksString(params.name),
        IncomeAccountRef: params.incomeAccountId
          ? quickBooksReference(params.incomeAccountId, 'incomeAccountId')
          : undefined,
        Description: optionalQuickBooksString(params.description),
        UnitPrice: validateQuickBooksOptionalNumber(params.unitPrice, 'unitPrice'),
        PurchaseDesc: optionalQuickBooksString(params.purchaseDescription),
        PurchaseCost: validateQuickBooksOptionalNumber(params.purchaseCost, 'purchaseCost'),
        ExpenseAccountRef: params.expenseAccountId
          ? quickBooksReference(params.expenseAccountId, 'expenseAccountId')
          : undefined,
        Taxable: params.taxable,
        Active: quickBooksActiveValue(params.activeStatus),
      }) as Record<string, unknown>
      assertQuickBooksSparseUpdate(body)
      return body
    },
    retry: { enabled: false },
    maxResponseBytes: QUICKBOOKS_MAX_RESPONSE_BYTES,
  },
  transformResponse: (response) =>
    transformQuickBooksMutationResponse<QuickBooksItem>(response, 'Item'),
  outputs: {
    record: {
      type: 'json',
      description: 'Updated QuickBooks Item record',
      properties: QUICKBOOKS_ITEM_PROPERTIES,
    },
    ...QUICKBOOKS_MUTATION_OUTPUTS,
  },
}
