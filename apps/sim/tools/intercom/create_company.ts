import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildIntercomUrl, handleIntercomError } from './types'

const logger = createLogger('IntercomCreateCompany')

export interface IntercomCreateCompanyParams {
  accessToken: string
  company_id: string
  name?: string
  website?: string
  plan?: string
  size?: number
  industry?: string
  monthly_spend?: number
  custom_attributes?: string
}

export interface IntercomCreateCompanyResponse {
  success: boolean
  output: {
    company: any
    metadata: {
      operation: 'create_company'
      companyId: string
    }
    success: boolean
  }
}

export const intercomCreateCompanyTool: ToolConfig<
  IntercomCreateCompanyParams,
  IntercomCreateCompanyResponse
> = {
  id: 'intercom_create_company',
  name: 'Create Company in Intercom',
  description: 'Create or update a company in Intercom',
  version: '1.0.0',

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Intercom API access token',
    },
    company_id: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your unique identifier for the company',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'The name of the company',
    },
    website: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'The company website',
    },
    plan: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'The company plan name',
    },
    size: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'The number of employees in the company',
    },
    industry: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'The industry the company operates in',
    },
    monthly_spend: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'How much revenue the company generates for your business',
    },
    custom_attributes: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Custom attributes as JSON object',
    },
  },

  request: {
    url: () => buildIntercomUrl('/companies'),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Intercom-Version': '2.14',
    }),
    body: (params) => {
      const company: any = {
        company_id: params.company_id,
      }

      if (params.name) company.name = params.name
      if (params.website) company.website = params.website
      if (params.plan) company.plan = params.plan
      if (params.size) company.size = params.size
      if (params.industry) company.industry = params.industry
      if (params.monthly_spend) company.monthly_spend = params.monthly_spend

      if (params.custom_attributes) {
        try {
          company.custom_attributes = JSON.parse(params.custom_attributes)
        } catch (error) {
          logger.warn('Failed to parse custom attributes', { error })
        }
      }

      return company
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleIntercomError(data, response.status, 'create_company')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        company: data,
        metadata: {
          operation: 'create_company' as const,
          companyId: data.id,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Created or updated company data',
      properties: {
        company: { type: 'object', description: 'Company object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
