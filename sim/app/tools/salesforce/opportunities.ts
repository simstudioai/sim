import { ToolConfig, ToolResponse } from '../types'

export interface OpportunityParams {
  apiKey: string
  action: 'create' | 'update' | 'search' | 'delete'
  id?: string
  name?: string
  accountId?: string
  stage?: string
  amount?: number
  closeDate?: string
  probability?: number
  properties?: Record<string, any>
  limit?: number
  offset?: number
  data: Record<string, any>
}

export interface OpportunityResponse extends ToolResponse {
  output: {
    records: any[]
    totalResults?: number
    pagination?: {
      hasMore: boolean
      offset: number
    }
  }
}

export const opportunitiesTool: ToolConfig<OpportunityParams, OpportunityResponse> = {
  id: 'salesforce_opportunities',
  name: 'Salesforce Opportunities',
  description:
    'Manage Salesforce sales opportunities with comprehensive CRUD operations. Track stages, amounts, probabilities, and related account data with support for custom fields and paginated results.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      requiredForToolCall: true,
      description: 'Salesforce API key',
    },
    action: {
      type: 'string',
      required: true,
      description: 'Action to perform (create, update, search, delete)',
    },
    id: {
      type: 'string',
      description: 'Opportunity ID (required for updates)',
    },
    name: {
      type: 'string',
      description: 'Opportunity name',
    },
    accountId: {
      type: 'string',
      description: 'Associated account ID',
    },
    stage: {
      type: 'string',
      description: 'Opportunity stage',
    },
    amount: {
      type: 'number',
      description: 'Opportunity amount',
    },
    closeDate: {
      type: 'string',
      description: 'Expected close date (YYYY-MM-DD)',
    },
    probability: {
      type: 'number',
      description: 'Probability of closing (%)',
    },
    properties: {
      type: 'object',
      description: 'Additional opportunity fields',
    },
    limit: {
      type: 'number',
      default: 100,
      description: 'Maximum number of records to return',
    },
    offset: {
      type: 'number',
      description: 'Offset for pagination',
    },
    data: {
      type: 'object',
      description: 'Data for the action',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = `${params.apiKey}@salesforce.com/services/data/v58.0/sobjects/Opportunity`
      if (params.id) {
        return `${baseUrl}/${params.id}`
      }
      return baseUrl
    },
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const fields = {
        Name: params.name,
        ...(params.accountId && { AccountId: params.accountId }),
        ...(params.stage && { StageName: params.stage }),
        ...(params.amount && { Amount: params.amount }),
        ...(params.closeDate && { CloseDate: params.closeDate }),
        ...(params.probability && { Probability: params.probability }),
        ...params.properties,
      }

      return fields
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        records: data.records || [data],
        totalResults: data.totalSize,
        pagination: {
          hasMore: !data.done,
          offset: data.nextRecordsUrl ? parseInt(data.nextRecordsUrl.split('-')[1]) : 0,
        },
      },
    }
  },

  transformError: (error) => {
    const message = error.message || error.error?.message
    const code = error.errorCode || error.error?.errorCode
    return `${message} (${code})`
  },
}
