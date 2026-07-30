import { QUICKBOOKS_MAX_RESPONSE_BYTES } from '@/lib/quickbooks/client'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  QuickBooksListResponse,
  QuickBooksPaginationParams,
  QuickBooksVendor,
} from '@/tools/quickbooks/types'
import {
  QUICKBOOKS_LIST_OUTPUTS,
  QUICKBOOKS_METADATA_PROPERTIES,
  QUICKBOOKS_REFERENCE_PROPERTIES,
} from '@/tools/quickbooks/types'
import {
  buildQuickBooksQueryUrl,
  getQuickBooksToolHeaders,
  transformQuickBooksListResponse,
} from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

export const quickbooksListVendorsTool: ToolConfig<
  QuickBooksPaginationParams,
  QuickBooksListResponse<QuickBooksVendor>
> = {
  id: 'quickbooks_list_vendors',
  name: 'QuickBooks List Vendors',
  description: 'List vendors in the connected QuickBooks Online company',
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
    startPosition: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      default: 1,
      description: 'One-based position of the first vendor to return',
    },
    maxResults: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      default: 25,
      description: 'Number of vendors to request (1–100)',
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
      buildQuickBooksQueryUrl(
        params.realmId,
        'Vendor',
        params.startPosition,
        params.maxResults
      ).toString(),
    method: 'GET',
    headers: (params) => getQuickBooksToolHeaders(params.accessToken),
    retry: { enabled: false },
    maxResponseBytes: QUICKBOOKS_MAX_RESPONSE_BYTES,
  },
  transformResponse: (response, params) =>
    transformQuickBooksListResponse<QuickBooksVendor>(response, params!, 'Vendor'),
  outputs: {
    items: {
      type: 'array',
      description: 'Vendor objects returned by QuickBooks',
      items: {
        type: 'json',
        properties: {
          Id: { type: 'string', description: 'Vendor ID' },
          SyncToken: { type: 'string', description: 'Vendor sync token', optional: true },
          DisplayName: { type: 'string', description: 'Vendor display name', optional: true },
          CompanyName: { type: 'string', description: 'Vendor company name', optional: true },
          GivenName: { type: 'string', description: 'Vendor given name', optional: true },
          FamilyName: { type: 'string', description: 'Vendor family name', optional: true },
          PrintOnCheckName: {
            type: 'string',
            description: 'Name printed on checks',
            optional: true,
          },
          Active: { type: 'boolean', description: 'Whether the vendor is active', optional: true },
          Vendor1099: {
            type: 'boolean',
            description: 'Whether the vendor is tracked for 1099 reporting',
            optional: true,
          },
          BillAddr: { type: 'json', description: 'Vendor billing address', optional: true },
          PrimaryPhone: {
            type: 'json',
            description: 'Vendor primary phone details',
            optional: true,
          },
          PrimaryEmailAddr: {
            type: 'json',
            description: 'Vendor primary email details',
            optional: true,
          },
          Balance: { type: 'number', description: 'Vendor balance', optional: true },
          CurrencyRef: {
            type: 'json',
            description: 'Vendor currency reference',
            optional: true,
            properties: QUICKBOOKS_REFERENCE_PROPERTIES,
          },
          MetaData: {
            type: 'json',
            description: 'Vendor creation and update timestamps',
            optional: true,
            properties: QUICKBOOKS_METADATA_PROPERTIES,
          },
        },
      },
    },
    ...QUICKBOOKS_LIST_OUTPUTS,
  },
}
