import { buildIntercomUrl, handleIntercomError } from '@/tools/intercom/types'
import type { ToolConfig } from '@/tools/types'

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

const getCompanyBase = {
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Intercom API access token',
    },
    companyId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Company ID to retrieve',
    },
  },

  request: {
    url: (params: IntercomGetCompanyParams) => buildIntercomUrl(`/companies/${params.companyId}`),
    method: 'GET',
    headers: (params: IntercomGetCompanyParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Intercom-Version': '2.14',
    }),
  },
} satisfies Pick<ToolConfig<IntercomGetCompanyParams, any>, 'params' | 'request'>

export const intercomGetCompanyTool: ToolConfig<
  IntercomGetCompanyParams,
  IntercomGetCompanyResponse
> = {
  id: 'intercom_get_company',
  name: 'Get Company from Intercom',
  description: 'Retrieve a single company by ID from Intercom',
  version: '1.0.0',

  ...getCompanyBase,

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
    company: {
      type: 'object',
      description: 'Company object',
      properties: {
        id: { type: 'string', description: 'Unique identifier for the company' },
        type: { type: 'string', description: 'Object type (company)' },
        app_id: { type: 'string', description: 'Intercom app ID' },
        company_id: { type: 'string', description: 'Your unique identifier for the company' },
        name: { type: 'string', description: 'Name of the company' },
        website: { type: 'string', description: 'Company website URL' },
        plan: { type: 'object', description: 'Company plan information' },
        size: { type: 'number', description: 'Number of employees' },
        industry: { type: 'string', description: 'Industry the company operates in' },
        monthly_spend: { type: 'number', description: 'Monthly revenue from this company' },
        session_count: { type: 'number', description: 'Number of sessions' },
        user_count: { type: 'number', description: 'Number of users in the company' },
        created_at: { type: 'number', description: 'Unix timestamp when company was created' },
        updated_at: { type: 'number', description: 'Unix timestamp when company was last updated' },
        custom_attributes: { type: 'object', description: 'Custom attributes set on the company' },
        tags: { type: 'object', description: 'Tags associated with the company' },
        segments: { type: 'object', description: 'Segments the company belongs to' },
      },
    },
    metadata: {
      type: 'object',
      description: 'Operation metadata',
      properties: {
        operation: { type: 'string', description: 'The operation performed (get_company)' },
      },
    },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}

interface IntercomGetCompanyV2Response {
  success: boolean
  output: {
    company: any
  }
}

export const intercomGetCompanyV2Tool: ToolConfig<
  IntercomGetCompanyParams,
  IntercomGetCompanyV2Response
> = {
  ...getCompanyBase,
  id: 'intercom_get_company_v2',
  name: 'Get Company from Intercom',
  description: 'Retrieve a single company by ID from Intercom',
  version: '2.0.0',

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
      },
    }
  },

  outputs: {
    company: {
      type: 'object',
      description: 'Company object',
      properties: {
        id: { type: 'string', description: 'Unique identifier for the company' },
        type: { type: 'string', description: 'Object type (company)' },
        app_id: { type: 'string', description: 'Intercom app ID' },
        company_id: { type: 'string', description: 'Your unique identifier for the company' },
        name: { type: 'string', description: 'Name of the company' },
        website: { type: 'string', description: 'Company website URL' },
        plan: { type: 'object', description: 'Company plan information' },
        size: { type: 'number', description: 'Number of employees' },
        industry: { type: 'string', description: 'Industry the company operates in' },
        monthly_spend: { type: 'number', description: 'Monthly revenue from this company' },
        session_count: { type: 'number', description: 'Number of sessions' },
        user_count: { type: 'number', description: 'Number of users in the company' },
        created_at: { type: 'number', description: 'Unix timestamp when company was created' },
        updated_at: { type: 'number', description: 'Unix timestamp when company was last updated' },
        custom_attributes: { type: 'object', description: 'Custom attributes set on the company' },
        tags: { type: 'object', description: 'Tags associated with the company' },
        segments: { type: 'object', description: 'Segments the company belongs to' },
      },
    },
  },
}
