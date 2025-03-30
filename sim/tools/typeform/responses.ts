import { ToolConfig, ToolResponse } from '../types'

interface TypeformResponsesParams {
  formId: string
  apiKey: string
  pageSize?: number
  since?: string
  until?: string
  completed?: string
}

interface TypeformResponsesResponse extends ToolResponse {
  output: {
    total_items: number
    page_count: number
    items: Array<{
      landing_id: string
      token: string
      landed_at: string
      submitted_at: string
      metadata: {
        user_agent: string
        platform: string
        referer: string
        network_id: string
        browser: string
      }
      answers: Array<{
        field: {
          id: string
          type: string
          ref: string
        }
        type: string
        [key: string]: any
      }>
      hidden: Record<string, any>
      calculated: {
        score: number
      }
      variables: Array<{
        key: string
        type: string
        [key: string]: any
      }>
    }>
  }
}

export const responsesTool: ToolConfig<TypeformResponsesParams, TypeformResponsesResponse> = {
  id: 'typeform_responses',
  name: 'Typeform Responses',
  description: 'Retrieve form responses from Typeform',
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
    pageSize: {
      type: 'number',
      required: false,
      description: 'Number of responses to retrieve (default: 25)',
    },
    since: {
      type: 'string',
      required: false,
      description: 'Retrieve responses submitted after this date (ISO 8601 format)',
    },
    until: {
      type: 'string',
      required: false,
      description: 'Retrieve responses submitted before this date (ISO 8601 format)',
    },
    completed: {
      type: 'string',
      required: false,
      description: 'Filter by completion status (true/false)',
    },
  },
  request: {
    url: (params: TypeformResponsesParams) => {
      const url = `https://api.typeform.com/forms/${params.formId}/responses`
      
      const queryParams = []
      
      if (params.pageSize) {
        queryParams.push(`page_size=${params.pageSize}`)
      }
      
      if (params.since) {
        queryParams.push(`since=${encodeURIComponent(params.since)}`)
      }
      
      if (params.until) {
        queryParams.push(`until=${encodeURIComponent(params.until)}`)
      }
      
      if (params.completed && params.completed !== 'all') {
        queryParams.push(`completed=${params.completed}`)
      }
      
      return queryParams.length > 0 ? `${url}?${queryParams.join('&')}` : url
    },
    method: 'GET',
    headers: (params) => ({
      'Authorization': `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },
  transformResponse: async (response: Response) => {
    if (!response.ok) {
      let errorMessage = response.statusText || 'Unknown error';
      
      try {
        const errorData = await response.json();
        if (errorData && errorData.message) {
          errorMessage = errorData.message;
        } else if (errorData && errorData.description) {
          errorMessage = errorData.description;
        } else if (typeof errorData === 'string') {
          errorMessage = errorData;
        }
      } catch (e) {
        // If we can't parse the error as JSON, just use the status text
      }
      
      throw new Error(`Typeform API error (${response.status}): ${errorMessage}`);
    }
    
    try {
      const data = await response.json();
      
      return {
        success: true,
        output: data,
      };
    } catch (error) {
      throw new Error(`Failed to parse Typeform response: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },
  transformError: (error) => {
    if (error instanceof Error) {
      return `Failed to retrieve Typeform responses: ${error.message}`
    }
    
    if (typeof error === 'object' && error !== null) {
      return `Failed to retrieve Typeform responses: ${JSON.stringify(error)}`
    }
    
    return `Failed to retrieve Typeform responses: An unknown error occurred`
  },
} 