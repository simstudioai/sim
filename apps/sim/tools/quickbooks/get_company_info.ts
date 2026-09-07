import { omit } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import {
  assertQuickBooksCompanyInfo,
  buildQuickBooksCompanyUrl,
  normalizeQuickBooksRealmId,
} from '@/tools/quickbooks/client'
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
    quickBooksEnvironment: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'QuickBooks API environment derived from the connected credential',
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
    url: (params) => {
      const realmId = normalizeQuickBooksRealmId(params.realmId)
      return buildQuickBooksCompanyUrl(
        realmId,
        `companyinfo/${encodeURIComponent(realmId)}`,
        params.quickBooksEnvironment
      ).toString()
    },
    method: 'GET',
    headers: (params) => getQuickBooksToolHeaders(params.accessToken),
    retry: { enabled: false },
  },
  transformResponse: async (response, params) => {
    normalizeQuickBooksRealmId(params?.realmId ?? '')
    const data = await parseQuickBooksJson<CompanyInfoEnvelope>(
      response,
      'QuickBooks CompanyInfo response'
    )
    const company = assertQuickBooksCompanyInfo<QuickBooksCompanyInfo>(data.CompanyInfo)
    const sanitizedCompany = omit(company, ['EmployerId']) as QuickBooksCompanyInfo
    return {
      success: true,
      output: {
        company: sanitizedCompany,
        time: typeof data.time === 'string' ? data.time : null,
      },
    }
  },
  outputs: {
    company: {
      type: 'json',
      description: 'Verified QuickBooks CompanyInfo object with tax identifiers removed',
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
