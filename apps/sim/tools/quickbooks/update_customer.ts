import { filterUndefined } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  QuickBooksCustomer,
  QuickBooksMutationResponse,
  QuickBooksUpdateCustomerParams,
} from '@/tools/quickbooks/types'
import {
  QUICKBOOKS_CUSTOMER_PROPERTIES,
  QUICKBOOKS_MUTATION_OUTPUTS,
} from '@/tools/quickbooks/types'
import {
  buildQuickBooksEntityUrl,
  getQuickBooksToolHeaders,
  sanitizeQuickBooksCustomer,
  transformQuickBooksMutationResponse,
} from '@/tools/quickbooks/utils'
import {
  assertQuickBooksSparseUpdate,
  optionalQuickBooksString,
  parseQuickBooksAddress,
  quickBooksActiveValue,
  quickBooksEmailAddress,
  quickBooksPhoneNumber,
  requiredQuickBooksString,
} from '@/tools/quickbooks/values'
import type { ToolConfig } from '@/tools/types'

export const quickbooksUpdateCustomerTool: ToolConfig<
  QuickBooksUpdateCustomerParams,
  QuickBooksMutationResponse<QuickBooksCustomer>
> = {
  id: 'quickbooks_update_customer',
  name: 'QuickBooks Update Customer',
  description: 'Sparse-update a customer in the connected QuickBooks Online company',
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
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the customer to update',
    },
    syncToken: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Current customer sync token',
    },
    displayName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement customer display name',
    },
    companyName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement customer company name',
    },
    givenName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement customer given name',
    },
    familyName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement customer family name',
    },
    primaryEmail: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement primary email address',
    },
    primaryPhone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement primary phone number',
    },
    billingAddress: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement billing address',
    },
    shippingAddress: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement shipping address',
    },
    taxable: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether sales to this customer are taxable',
    },
    activeStatus: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      default: 'unchanged',
      description: 'Customer status change: unchanged, active, or inactive',
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
    url: (params) => buildQuickBooksEntityUrl(params, 'customer').toString(),
    method: 'POST',
    headers: (params) => getQuickBooksToolHeaders(params.accessToken, 'application/json'),
    body: (params) => {
      const body = filterUndefined({
        Id: requiredQuickBooksString(params.customerId, 'customerId'),
        SyncToken: requiredQuickBooksString(params.syncToken, 'syncToken'),
        sparse: true,
        DisplayName: optionalQuickBooksString(params.displayName),
        CompanyName: optionalQuickBooksString(params.companyName),
        GivenName: optionalQuickBooksString(params.givenName),
        FamilyName: optionalQuickBooksString(params.familyName),
        PrimaryEmailAddr: quickBooksEmailAddress(params.primaryEmail),
        PrimaryPhone: quickBooksPhoneNumber(params.primaryPhone),
        BillAddr: parseQuickBooksAddress(params.billingAddress, 'billingAddress'),
        ShipAddr: parseQuickBooksAddress(params.shippingAddress, 'shippingAddress'),
        Taxable: params.taxable,
        Active: quickBooksActiveValue(params.activeStatus),
      }) as Record<string, unknown>
      assertQuickBooksSparseUpdate(body)
      return body
    },
    retry: { enabled: false },
  },
  transformResponse: (response) =>
    transformQuickBooksMutationResponse<QuickBooksCustomer>(
      response,
      'Customer',
      sanitizeQuickBooksCustomer
    ),
  outputs: {
    record: {
      type: 'json',
      description: 'Updated QuickBooks Customer record',
      properties: QUICKBOOKS_CUSTOMER_PROPERTIES,
    },
    ...QUICKBOOKS_MUTATION_OUTPUTS,
  },
}
