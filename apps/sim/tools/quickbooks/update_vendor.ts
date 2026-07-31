import { filterUndefined } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { QUICKBOOKS_MAX_RESPONSE_BYTES } from '@/tools/quickbooks/client'
import type {
  QuickBooksMutationResponse,
  QuickBooksUpdateVendorParams,
  QuickBooksVendor,
} from '@/tools/quickbooks/types'
import { QUICKBOOKS_MUTATION_OUTPUTS, QUICKBOOKS_VENDOR_PROPERTIES } from '@/tools/quickbooks/types'
import {
  assertQuickBooksSparseUpdate,
  buildQuickBooksEntityUrl,
  getQuickBooksToolHeaders,
  optionalQuickBooksString,
  quickBooksActiveValue,
  quickBooksEmailAddress,
  quickBooksPhoneNumber,
  requiredQuickBooksString,
  sanitizeQuickBooksVendor,
  transformQuickBooksMutationResponse,
} from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

export const quickbooksUpdateVendorTool: ToolConfig<
  QuickBooksUpdateVendorParams,
  QuickBooksMutationResponse<QuickBooksVendor>
> = {
  id: 'quickbooks_update_vendor',
  name: 'QuickBooks Update Vendor',
  description: 'Sparse-update a vendor in the connected QuickBooks Online company',
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
    vendorId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the vendor to update',
    },
    syncToken: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Current vendor sync token',
    },
    displayName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement vendor display name',
    },
    companyName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement vendor company name',
    },
    givenName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement vendor given name',
    },
    familyName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement vendor family name',
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
    printOnCheckName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement name to print on checks',
    },
    accountNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement vendor account number',
    },
    vendor1099: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the vendor is tracked for 1099 reporting',
    },
    activeStatus: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      default: 'unchanged',
      description: 'Keep, activate, or deactivate the vendor',
    },
  },
  oauth: {
    required: true,
    provider: 'quickbooks',
    requiredScopes: ['com.intuit.quickbooks.accounting'],
  },
  errorExtractor: ErrorExtractorId.QUICKBOOKS_FAULT,
  request: {
    url: (params) => buildQuickBooksEntityUrl(params.realmId, 'vendor').toString(),
    method: 'POST',
    headers: (params) => getQuickBooksToolHeaders(params.accessToken, 'application/json'),
    body: (params) => {
      const body = filterUndefined({
        Id: requiredQuickBooksString(params.vendorId, 'vendorId'),
        SyncToken: requiredQuickBooksString(params.syncToken, 'syncToken'),
        sparse: true,
        DisplayName: optionalQuickBooksString(params.displayName),
        CompanyName: optionalQuickBooksString(params.companyName),
        GivenName: optionalQuickBooksString(params.givenName),
        FamilyName: optionalQuickBooksString(params.familyName),
        PrimaryEmailAddr: quickBooksEmailAddress(params.primaryEmail),
        PrimaryPhone: quickBooksPhoneNumber(params.primaryPhone),
        BillAddr: params.billingAddress,
        PrintOnCheckName: optionalQuickBooksString(params.printOnCheckName),
        AcctNum: optionalQuickBooksString(params.accountNumber),
        Vendor1099: params.vendor1099,
        Active: quickBooksActiveValue(params.activeStatus),
      }) as Record<string, unknown>
      assertQuickBooksSparseUpdate(body)
      return body
    },
    retry: { enabled: false },
    maxResponseBytes: QUICKBOOKS_MAX_RESPONSE_BYTES,
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
      description: 'Updated QuickBooks Vendor record',
      properties: QUICKBOOKS_VENDOR_PROPERTIES,
    },
    ...QUICKBOOKS_MUTATION_OUTPUTS,
  },
}
