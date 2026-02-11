import type { ToolConfig } from '@/tools/types'

interface PostHogGetSurveyParams {
  apiKey: string
  projectId: string
  surveyId: string
  region?: 'us' | 'eu'
}

interface PostHogSurveyQuestion {
  type: 'open' | 'link' | 'rating' | 'multiple_choice'
  question: string
  description?: string
  choices?: string[]
  scale?: number
  lowerBoundLabel?: string
  upperBoundLabel?: string
}

interface PostHogSurvey {
  id: string
  name: string
  description: string
  type: 'popover' | 'api'
  questions: PostHogSurveyQuestion[]
  appearance?: Record<string, any>
  conditions?: Record<string, any>
  created_at: string
  created_by: Record<string, any>
  start_date?: string
  end_date?: string
  archived?: boolean
  targeting_flag_filters?: Record<string, any>
  linked_flag?: Record<string, any>
  responses_limit?: number
  current_iteration?: number
}

interface PostHogGetSurveyResponse {
  success: boolean
  output: {
    survey: PostHogSurvey
  }
}

export const getSurveyTool: ToolConfig<PostHogGetSurveyParams, PostHogGetSurveyResponse> = {
  id: 'posthog_get_survey',
  name: 'PostHog Get Survey',
  description: 'Get details of a specific survey in PostHog by ID.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PostHog Personal API Key',
    },
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'PostHog Project ID (e.g., "12345" or project UUID)',
    },
    surveyId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Survey ID to retrieve (e.g., "01234567-89ab-cdef-0123-456789abcdef")',
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'PostHog cloud region: us or eu (default: us)',
      default: 'us',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.region === 'eu' ? 'https://eu.posthog.com' : 'https://us.posthog.com'
      return `${baseUrl}/api/projects/${params.projectId}/surveys/${params.surveyId}/`
    },
    method: 'GET',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        survey: data,
      },
    }
  },

  outputs: {
    survey: {
      type: 'object',
      description: 'Survey details',
      properties: {
        id: { type: 'string', description: 'Survey ID' },
        name: { type: 'string', description: 'Survey name' },
        description: { type: 'string', description: 'Survey description' },
        type: { type: 'string', description: 'Survey type (popover or api)' },
        questions: {
          type: 'array',
          description: 'Survey questions',
        },
        appearance: {
          type: 'object',
          description: 'Survey appearance configuration',
        },
        conditions: {
          type: 'object',
          description: 'Survey display conditions',
        },
        created_at: { type: 'string', description: 'Creation timestamp' },
        created_by: { type: 'object', description: 'Creator information' },
        start_date: { type: 'string', description: 'Survey start date' },
        end_date: { type: 'string', description: 'Survey end date' },
        archived: { type: 'boolean', description: 'Whether survey is archived' },
        responses_limit: { type: 'number', description: 'Maximum number of responses' },
      },
    },
  },
}
