import { filterUndefined } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  QuickBooksCreateCustomerParams,
  QuickBooksCustomer,
  QuickBooksMutationResponse,
} from '@/tools/quickbooks/types'
import {
  QUICKBOOKS_CUSTOMER_PROPERTIES,
  QUICKBOOKS_MUTATION_OUTPUTS,
} from '@/tools/quickbooks/types'
import {
  addQuickBooksRequestId,
  buildQuickBooksEntityUrl,
  getQuickBooksToolHeaders,
  sanitizeQuickBooksCustomer,
  transformQuickBooksMutationResponse,
} from '@/tools/quickbooks/utils'
import {
  optionalQuickBooksString,
  parseQuickBooksAddress,
  quickBooksEmailAddress,
  quickBooksPhoneNumber,
} from '@/tools/quickbooks/values'
import type { ToolConfig } from '@/tools/types'

export const quickbooksCreateCustomerTool: ToolConfig<
  QuickBooksCreateCustomerParams,
  QuickBooksMutationResponse<QuickBooksCustomer>
> = {
  id: 'quickbooks_create_customer',
  name: 'QuickBooks Create Customer',
  description: 'Create a customer in the connected QuickBooks Online company',
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
    displayName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Unique customer display name. Required unless givenName or familyName is supplied',
    },
    companyName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Customer company name',
    },
    givenName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Customer given name',
    },
    familyName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Customer family name',
    },
    primaryEmail: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Customer primary email address',
    },
    primaryPhone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Customer primary phone number',
    },
    billingAddress: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Customer billing address',
    },
    shippingAddress: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Customer shipping address',
    },
    taxable: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether sales to this customer are taxable',
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
      addQuickBooksRequestId(
        buildQuickBooksEntityUrl(params, 'customer'),
        params.requestId
      ).toString(),
    method: 'POST',
    headers: (params) => getQuickBooksToolHeaders(params.accessToken, 'application/json'),
    body: (params) => {
      const displayName = optionalQuickBooksString(params.displayName)
      const givenName = optionalQuickBooksString(params.givenName)
      const familyName = optionalQuickBooksString(params.familyName)
      if (displayName === undefined && givenName === undefined && familyName === undefined) {
        throw new Error('At least one of displayName, givenName, or familyName must be supplied')
      }
      return filterUndefined({
        DisplayName: displayName,
        CompanyName: optionalQuickBooksString(params.companyName),
        GivenName: givenName,
        FamilyName: familyName,
        PrimaryEmailAddr: quickBooksEmailAddress(params.primaryEmail),
        PrimaryPhone: quickBooksPhoneNumber(params.primaryPhone),
        BillAddr: parseQuickBooksAddress(params.billingAddress, 'billingAddress'),
        ShipAddr: parseQuickBooksAddress(params.shippingAddress, 'shippingAddress'),
        Taxable: params.taxable,
      })
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
      description: 'Created QuickBooks Customer record',
      properties: QUICKBOOKS_CUSTOMER_PROPERTIES,
    },
    ...QUICKBOOKS_MUTATION_OUTPUTS,
  },
}
