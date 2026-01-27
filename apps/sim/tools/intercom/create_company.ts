import { createLogger } from '@sim/logger'
import { buildIntercomUrl, handleIntercomError } from '@/tools/intercom/types'
import type { ToolConfig } from '@/tools/types'

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
  remote_created_at?: number
}

export interface IntercomCreateCompanyResponse {
  success: boolean
  output: {
    company: {
      id: string
      type: string
      app_id: string
      company_id: string
      name?: string
      website?: string
      plan: Record<string, any>
      size?: number
      industry?: string
      monthly_spend: number
      session_count: number
      user_count: number
      created_at: number
      updated_at: number
      remote_created_at?: number
      custom_attributes: Record<string, any>
      tags: {
        type: string
        tags: any[]
      }
      segments: {
        type: string
        segments: any[]
      }
      [key: string]: any
    }
    metadata: {
      operation: 'create_company'
      companyId: string
    }
    success: boolean
  }
}

const createCompanyBase = {
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Intercom API access token',
    },
    company_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Your unique identifier for the company',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The name of the company',
    },
    website: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The company website',
    },
    plan: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The company plan name',
    },
    size: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'The number of employees in the company',
    },
    industry: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The industry the company operates in',
    },
    monthly_spend: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'How much revenue the company generates for your business. Note: This field truncates floats to whole integers (e.g., 155.98 becomes 155)',
    },
    custom_attributes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom attributes as JSON object',
    },
    remote_created_at: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'The time the company was created by you as a Unix timestamp',
    },
  },

  request: {
    url: () => buildIntercomUrl('/companies'),
    method: 'POST',
    headers: (params: IntercomCreateCompanyParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Intercom-Version': '2.14',
    }),
    body: (params: IntercomCreateCompanyParams) => {
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

      if (params.remote_created_at) company.remote_created_at = params.remote_created_at

      return company
    },
  },
} satisfies Pick<ToolConfig<IntercomCreateCompanyParams, any>, 'params' | 'request'>

export const intercomCreateCompanyTool: ToolConfig<
  IntercomCreateCompanyParams,
  IntercomCreateCompanyResponse
> = {
  id: 'intercom_create_company',
  name: 'Create Company in Intercom',
  description: 'Create or update a company in Intercom',
  version: '1.0.0',

  ...createCompanyBase,

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
    company: {
      type: 'object',
      description: 'Created or updated company object',
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
        remote_created_at: {
          type: 'number',
          description: 'Unix timestamp when company was created by you',
        },
        custom_attributes: { type: 'object', description: 'Custom attributes set on the company' },
        tags: {
          type: 'object',
          description: 'Tags associated with the company',
          properties: {
            type: { type: 'string', description: 'Tag list type' },
            tags: { type: 'array', description: 'Array of tag objects' },
          },
        },
        segments: {
          type: 'object',
          description: 'Segments the company belongs to',
          properties: {
            type: { type: 'string', description: 'Segment list type' },
            segments: { type: 'array', description: 'Array of segment objects' },
          },
        },
      },
    },
    metadata: {
      type: 'object',
      description: 'Operation metadata',
      properties: {
        operation: { type: 'string', description: 'The operation performed (create_company)' },
        companyId: { type: 'string', description: 'ID of the created/updated company' },
      },
    },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}

interface IntercomCreateCompanyV2Response {
  success: boolean
  output: {
    company: {
      id: string
      type: string
      app_id: string
      company_id: string
      name?: string
      website?: string
      plan: Record<string, any>
      size?: number
      industry?: string
      monthly_spend: number
      session_count: number
      user_count: number
      created_at: number
      updated_at: number
      remote_created_at?: number
      custom_attributes: Record<string, any>
      tags: {
        type: string
        tags: any[]
      }
      segments: {
        type: string
        segments: any[]
      }
      [key: string]: any
    }
    companyId: string
  }
}

export const intercomCreateCompanyV2Tool: ToolConfig<
  IntercomCreateCompanyParams,
  IntercomCreateCompanyV2Response
> = {
  ...createCompanyBase,
  id: 'intercom_create_company_v2',
  name: 'Create Company in Intercom',
  description: 'Create or update a company in Intercom',
  version: '2.0.0',

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
        companyId: data.id,
      },
    }
  },

  outputs: {
    company: {
      type: 'object',
      description: 'Created or updated company object',
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
        remote_created_at: {
          type: 'number',
          description: 'Unix timestamp when company was created by you',
        },
        custom_attributes: { type: 'object', description: 'Custom attributes set on the company' },
        tags: {
          type: 'object',
          description: 'Tags associated with the company',
          properties: {
            type: { type: 'string', description: 'Tag list type' },
            tags: { type: 'array', description: 'Array of tag objects' },
          },
        },
        segments: {
          type: 'object',
          description: 'Segments the company belongs to',
          properties: {
            type: { type: 'string', description: 'Segment list type' },
            segments: { type: 'array', description: 'Array of segment objects' },
          },
        },
      },
    },
    companyId: { type: 'string', description: 'ID of the created/updated company' },
  },
}
