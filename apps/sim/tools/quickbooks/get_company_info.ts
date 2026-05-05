import { createLogger } from '@sim/logger'
import type { QuickBooksBaseParams, QuickBooksCompanyInfoResponse } from '@/tools/quickbooks/types'
import { COMPANY_INFO_OUTPUT } from '@/tools/quickbooks/types'
import { buildCompanyUrl, quickbooksAuthHeaders } from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('QuickBooksGetCompanyInfo')

export const quickbooksGetCompanyInfoTool: ToolConfig<
  QuickBooksBaseParams,
  QuickBooksCompanyInfoResponse
> = {
  id: 'quickbooks_get_company_info',
  name: 'QuickBooks Get Company Info',
  description: 'Retrieve company information for the connected QuickBooks Online company',
  version: '1.0.0',

  oauth: { required: true, provider: 'quickbooks' },

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
      description: 'QuickBooks company ID (realmId) — captured at OAuth time',
    },
  },

  request: {
    url: (params) =>
      `${buildCompanyUrl(params.realmId, `/companyinfo/${encodeURIComponent(params.realmId)}`)}?minorversion=73`,
    method: 'GET',
    headers: (params) => quickbooksAuthHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('QuickBooks get company info failed', { status: response.status, data })
      throw new Error(data?.Fault?.Error?.[0]?.Message || 'Failed to get QuickBooks company info')
    }
    const companyInfo = (data?.CompanyInfo ?? null) as Record<string, unknown> | null
    return {
      success: true,
      output: { companyInfo },
    }
  },

  outputs: {
    companyInfo: {
      type: 'object',
      description: 'Company information record',
      properties: COMPANY_INFO_OUTPUT,
    },
  },
}
