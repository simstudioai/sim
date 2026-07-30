import {
  buildQuickBooksCompanyUrl,
  normalizeQuickBooksRealmId,
  QUICKBOOKS_MAX_RESPONSE_BYTES,
} from '@/lib/quickbooks/client'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  QuickBooksAuthParams,
  QuickBooksCompanyInfo,
  QuickBooksCompanyInfoResponse,
} from '@/tools/quickbooks/types'
import { QUICKBOOKS_COMPANY_INFO_PROPERTIES } from '@/tools/quickbooks/types'
import { getQuickBooksToolHeaders, parseQuickBooksJson } from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

interface CompanyInfoEnvelope {
  CompanyInfo?: QuickBooksCompanyInfo
  time?: string
}

export const quickbooksGetCompanyInfoTool: ToolConfig<
  QuickBooksAuthParams,
  QuickBooksCompanyInfoResponse
> = {
  id: 'quickbooks_get_company_info',
  name: 'QuickBooks Get Company Info',
  description: 'Get information about the connected QuickBooks Online company',
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
  },
  oauth: {
    required: true,
    provider: 'quickbooks',
    requiredScopes: ['com.intuit.quickbooks.accounting'],
  },
  errorExtractor: ErrorExtractorId.QUICKBOOKS_FAULT,
  request: {
    url: (params) => {
      const realmId = normalizeQuickBooksRealmId(params.realmId)
      return buildQuickBooksCompanyUrl(
        realmId,
        `companyinfo/${encodeURIComponent(realmId)}`
      ).toString()
    },
    method: 'GET',
    headers: (params) => getQuickBooksToolHeaders(params.accessToken),
    retry: { enabled: false },
    maxResponseBytes: QUICKBOOKS_MAX_RESPONSE_BYTES,
  },
  transformResponse: async (response) => {
    const data = await parseQuickBooksJson<CompanyInfoEnvelope>(
      response,
      'QuickBooks CompanyInfo response'
    )
    if (!data.CompanyInfo || typeof data.CompanyInfo !== 'object') {
      throw new Error('QuickBooks CompanyInfo response is missing CompanyInfo')
    }
    return {
      success: true,
      output: {
        company: data.CompanyInfo,
        time: typeof data.time === 'string' ? data.time : null,
      },
    }
  },
  outputs: {
    company: {
      type: 'json',
      description:
        'Verified QuickBooks CompanyInfo object, including Id, CompanyName, LegalName, addresses, contact details, NameValue settings, and MetaData when populated',
      properties: QUICKBOOKS_COMPANY_INFO_PROPERTIES,
    },
    time: {
      type: 'string',
      description: 'QuickBooks response timestamp',
      optional: true,
      nullable: true,
    },
  },
}
