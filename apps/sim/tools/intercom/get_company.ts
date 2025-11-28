import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildIntercomUrl, handleIntercomError } from './types'

const logger = createLogger('IntercomGetCompany')

export interface IntercomGetCompanyParams {
  accessToken: string
  companyId: string
}

export interface IntercomGetCompanyResponse {
  success: boolean
  output: {
    company: any
    metadata: {
      operation: 'get_company'
    }
    success: boolean
  }
}

export const intercomGetCompanyTool: ToolConfig<
  IntercomGetCompanyParams,
  IntercomGetCompanyResponse
> = {
  id: 'intercom_get_company',
  name: 'Get Company from Intercom',
  description: 'Retrieve a single company by ID from Intercom',
  version: '1.0.0',

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Intercom API access token',
    },
    companyId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Company ID to retrieve',
    },
  },

  request: {
    url: (params) => buildIntercomUrl(`/companies/${params.companyId}`),
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Intercom-Version': '2.14',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleIntercomError(data, response.status, 'get_company')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        company: data,
        metadata: {
          operation: 'get_company' as const,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Company data',
      properties: {
        company: { type: 'object', description: 'Company object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
