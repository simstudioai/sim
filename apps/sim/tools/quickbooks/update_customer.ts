import { filterUndefined } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { QUICKBOOKS_MAX_RESPONSE_BYTES } from '@/tools/quickbooks/client'
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
  assertQuickBooksSparseUpdate,
  buildQuickBooksEntityUrl,
  getQuickBooksToolHeaders,
  optionalQuickBooksString,
  quickBooksActiveValue,
  quickBooksEmailAddress,
  quickBooksPhoneNumber,
  requiredQuickBooksString,
  transformQuickBooksMutationResponse,
} from '@/tools/quickbooks/utils'
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
      required: true,
      visibility: 'user-or-llm',
      default: 'unchanged',
      description: 'Keep, activate, or deactivate the customer',
    },
  },
  oauth: {
    required: true,
    provider: 'quickbooks',
    requiredScopes: ['com.intuit.quickbooks.accounting'],
  },
  errorExtractor: ErrorExtractorId.QUICKBOOKS_FAULT,
  request: {
    url: (params) => buildQuickBooksEntityUrl(params.realmId, 'customer').toString(),
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
        BillAddr: params.billingAddress,
        ShipAddr: params.shippingAddress,
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
    transformQuickBooksMutationResponse<QuickBooksCustomer>(response, 'Customer'),
  outputs: {
    record: {
      type: 'json',
      description: 'Updated QuickBooks Customer record',
      properties: QUICKBOOKS_CUSTOMER_PROPERTIES,
    },
    ...QUICKBOOKS_MUTATION_OUTPUTS,
  },
}
