import { createLogger } from '@/lib/logs/console/logger'
import type { TypeformInsightsParams, TypeformInsightsResponse } from '@/tools/typeform/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('TypeformInsightsTool')

export const insightsTool: ToolConfig<TypeformInsightsParams, TypeformInsightsResponse> = {
  id: 'typeform_insights',
  name: 'Typeform Insights',
  description: 'Retrieve insights and analytics for Typeform forms',
  version: '1.0.0',

  params: {
    formId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Typeform form ID',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Typeform Personal Access Token',
    },
  },

  request: {
    url: (params: TypeformInsightsParams) => {
      const encodedFormId = encodeURIComponent(params.formId)
      return `https://api.typeform.com/insights/${encodedFormId}/summary`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: data,
    }
  },

  outputs: {
    fields: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          dropoffs: {
            type: 'number',
            description: 'Number of users who dropped off at this field',
          },
          id: { type: 'string', description: 'Unique field ID' },
          label: { type: 'string', description: 'Field label' },
          ref: { type: 'string', description: 'Field reference name' },
          title: { type: 'string', description: 'Field title/question' },
          type: { type: 'string', description: 'Field type (e.g., short_text, multiple_choice)' },
          views: { type: 'number', description: 'Number of times this field was viewed' },
        },
      },
      description: 'Analytics data for individual form fields',
    },
    form: {
      type: 'object',
      properties: {
        platforms: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              average_time: {
                type: 'number',
                description: 'Average completion time for this platform',
              },
              completion_rate: { type: 'number', description: 'Completion rate for this platform' },
              platform: { type: 'string', description: 'Platform name (e.g., desktop, mobile)' },
              responses_count: {
                type: 'number',
                description: 'Number of responses from this platform',
              },
              total_visits: { type: 'number', description: 'Total visits from this platform' },
              unique_visits: { type: 'number', description: 'Unique visits from this platform' },
            },
          },
          description: 'Platform-specific analytics data',
        },
        summary: {
          type: 'object',
          properties: {
            average_time: { type: 'number', description: 'Overall average completion time' },
            completion_rate: { type: 'number', description: 'Overall completion rate' },
            responses_count: { type: 'number', description: 'Total number of responses' },
            total_visits: { type: 'number', description: 'Total number of visits' },
            unique_visits: { type: 'number', description: 'Total number of unique visits' },
          },
          description: 'Overall form performance summary',
        },
      },
      description: 'Form-level analytics and performance data',
    },
  },
}
