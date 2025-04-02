import { ToolConfig, ToolResponse } from '../types'

interface TypeformInsightsParams {
  formId: string
  apiKey: string
}

// This is the actual output data structure from the API
interface TypeformInsightsData {
  fields: Array<{
    dropoffs: number
    id: string
    label: string
    ref: string
    title: string
    type: string
    views: number
  }>
  form: {
    platforms: Array<{
      average_time: number
      completion_rate: number
      platform: string
      responses_count: number
      total_visits: number
      unique_visits: number
    }>
    summary: {
      average_time: number
      completion_rate: number
      responses_count: number
      total_visits: number
      unique_visits: number
    }
  }
}

// The ToolResponse uses a union type to allow either successful data or empty object in error case
interface TypeformInsightsResponse extends ToolResponse {
  output: TypeformInsightsData | Record<string, never>
}

export const insightsTool: ToolConfig<TypeformInsightsParams, TypeformInsightsResponse> = {
  id: 'typeform_insights',
  name: 'Typeform Insights',
  description: 'Retrieve insights and analytics for Typeform forms',
  version: '1.0.0',
  params: {
    formId: {
      type: 'string',
      required: true,
      description: 'Typeform form ID',
    },
    apiKey: {
      type: 'string',
      required: true,
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
    if (!response.ok) {
      let errorMessage = response.statusText || 'Unknown error'
      let errorDetails = ''

      try {
        const errorData = await response.json()
        console.log('Typeform API error response:', JSON.stringify(errorData, null, 2))

        if (errorData && errorData.message) {
          errorMessage = errorData.message
        } else if (errorData && errorData.description) {
          errorMessage = errorData.description
        } else if (typeof errorData === 'string') {
          errorMessage = errorData
        }

        // Extract more details if available
        if (errorData && errorData.details) {
          errorDetails = ` Details: ${JSON.stringify(errorData.details)}`
        }

        // Special handling for 403 errors
        if (response.status === 403) {
          return {
            success: false,
            output: {},
            error: `Access forbidden (403) to Typeform Insights API. This could be due to:
1. Missing 'read:insights' scope on your API token
2. Insufficient plan subscription (insights may require a higher plan)
3. No access rights to the specified form
4. API token is invalid or expired
Details from API: ${errorMessage}${errorDetails}`,
          }
        }
      } catch (e) {
        // If we can't parse the error as JSON, just use the status text
        console.log('Error parsing Typeform API error:', e)
      }

      throw new Error(`Typeform API error (${response.status}): ${errorMessage}${errorDetails}`)
    }

    const data = await response.json()

    return {
      success: true,
      output: data,
    }
  },
  transformError: (error) => {
    if (error instanceof Error) {
      return `Failed to retrieve Typeform insights: ${error.message}`
    }

    if (typeof error === 'object' && error !== null) {
      return `Failed to retrieve Typeform insights: ${JSON.stringify(error)}`
    }

    return `Failed to retrieve Typeform insights: An unknown error occurred`
  },
}
