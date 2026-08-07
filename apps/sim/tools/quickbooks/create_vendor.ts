import { filterUndefined } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  QuickBooksCreateVendorParams,
  QuickBooksMutationResponse,
  QuickBooksVendor,
} from '@/tools/quickbooks/types'
import { QUICKBOOKS_MUTATION_OUTPUTS, QUICKBOOKS_VENDOR_PROPERTIES } from '@/tools/quickbooks/types'
import {
  addQuickBooksRequestId,
  buildQuickBooksEntityUrl,
  getQuickBooksToolHeaders,
  sanitizeQuickBooksVendor,
  transformQuickBooksMutationResponse,
} from '@/tools/quickbooks/utils'
import {
  optionalQuickBooksString,
  parseQuickBooksAddress,
  quickBooksEmailAddress,
  quickBooksPhoneNumber,
  requiredQuickBooksString,
} from '@/tools/quickbooks/values'
import type { ToolConfig } from '@/tools/types'

export const quickbooksCreateVendorTool: ToolConfig<
  QuickBooksCreateVendorParams,
  QuickBooksMutationResponse<QuickBooksVendor>
> = {
  id: 'quickbooks_create_vendor',
  name: 'QuickBooks Create Vendor',
  description: 'Create a vendor in the connected QuickBooks Online company',
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
    displayName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique vendor display name',
    },
    companyName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Vendor company name',
    },
    givenName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Vendor given name',
    },
    familyName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Vendor family name',
    },
    primaryEmail: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Vendor primary email address',
    },
    primaryPhone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Vendor primary phone number',
    },
    billingAddress: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Vendor billing address',
    },
    printOnCheckName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Name to print on checks',
    },
    accountNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Vendor account number',
    },
    vendor1099: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the vendor is tracked for 1099 reporting',
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
        buildQuickBooksEntityUrl(params.realmId, 'vendor'),
        params.requestId
      ).toString(),
    method: 'POST',
    headers: (params) => getQuickBooksToolHeaders(params.accessToken, 'application/json'),
    body: (params) =>
      filterUndefined({
        DisplayName: requiredQuickBooksString(params.displayName, 'displayName'),
        CompanyName: optionalQuickBooksString(params.companyName),
        GivenName: optionalQuickBooksString(params.givenName),
        FamilyName: optionalQuickBooksString(params.familyName),
        PrimaryEmailAddr: quickBooksEmailAddress(params.primaryEmail),
        PrimaryPhone: quickBooksPhoneNumber(params.primaryPhone),
        BillAddr: parseQuickBooksAddress(params.billingAddress, 'billingAddress'),
        PrintOnCheckName: optionalQuickBooksString(params.printOnCheckName),
        AcctNum: optionalQuickBooksString(params.accountNumber),
        Vendor1099: params.vendor1099,
      }),
    retry: { enabled: false },
  },
  transformResponse: (response) =>
    transformQuickBooksMutationResponse<QuickBooksVendor>(
      response,
      'Vendor',
      sanitizeQuickBooksVendor
    ),
  outputs: {
    record: {
      type: 'json',
      description: 'Created QuickBooks Vendor record',
      properties: QUICKBOOKS_VENDOR_PROPERTIES,
    },
    ...QUICKBOOKS_MUTATION_OUTPUTS,
  },
}
