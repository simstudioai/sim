import type { ToolConfig } from '@/tools/types'

interface PostHogSurveyQuestion {
  type: 'open' | 'link' | 'rating' | 'multiple_choice'
  question: string
  description?: string
  choices?: string[]
  scale?: number
  lowerBoundLabel?: string
  upperBoundLabel?: string
  buttonText?: string
}

interface PostHogCreateSurveyParams {
  apiKey: string
  projectId: string
  region?: 'us' | 'eu'
  name: string
  description?: string
  type?: 'popover' | 'api'
  questions: string // JSON string of questions array
  startDate?: string
  endDate?: string
  appearance?: string // JSON string of appearance config
  conditions?: string // JSON string of conditions
  targetingFlagFilters?: string // JSON string of targeting filters
  linkedFlagId?: string
  responsesLimit?: number
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
}

interface PostHogCreateSurveyResponse {
  success: boolean
  output: {
    survey: PostHogSurvey
  }
}

export const createSurveyTool: ToolConfig<PostHogCreateSurveyParams, PostHogCreateSurveyResponse> =
  {
    id: 'posthog_create_survey',
    name: 'PostHog Create Survey',
    description:
      'Create a new survey in PostHog. Supports question types: Basic (open), Link, Rating, and Multiple Choice.',
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
      region: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'PostHog cloud region: us or eu (default: us)',
        default: 'us',
      },
      name: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Survey name (optional)',
      },
      description: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Survey description',
      },
      type: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Survey type: popover (in-app) or api (custom implementation) (default: popover)',
        default: 'popover',
      },
      questions: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description:
          'JSON string of survey questions array. Each question must have type (open/link/rating/multiple_choice) and question text. Rating questions can have scale (1-10), lowerBoundLabel, upperBoundLabel. Multiple choice questions need choices array. Link questions can have buttonText.',
      },
      startDate: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Survey start date in ISO 8601 format',
      },
      endDate: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Survey end date in ISO 8601 format',
      },
      appearance: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'JSON string of appearance configuration (colors, position, etc.)',
      },
      conditions: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'JSON string of display conditions (URL matching, etc.)',
      },
      targetingFlagFilters: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'JSON string of feature flag filters for targeting',
      },
      linkedFlagId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Feature flag ID to link to this survey',
      },
      responsesLimit: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Maximum number of responses to collect',
      },
    },

    request: {
      url: (params) => {
        const baseUrl = params.region === 'eu' ? 'https://eu.posthog.com' : 'https://us.posthog.com'
        return `${baseUrl}/api/projects/${params.projectId}/surveys/`
      },
      method: 'POST',
      headers: (params) => ({
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      }),
      body: (params) => {
        const body: Record<string, any> = {
          name: params.name,
          type: params.type || 'popover',
          questions: JSON.parse(params.questions),
        }

        if (params.description) body.description = params.description
        if (params.startDate) body.start_date = params.startDate
        if (params.endDate) body.end_date = params.endDate
        if (params.appearance) body.appearance = JSON.parse(params.appearance)
        if (params.conditions) body.conditions = JSON.parse(params.conditions)
        if (params.targetingFlagFilters) {
          body.targeting_flag_filters = JSON.parse(params.targetingFlagFilters)
        }
        if (params.linkedFlagId) body.linked_flag_id = params.linkedFlagId
        if (params.responsesLimit) body.responses_limit = params.responsesLimit

        return body
      },
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
        description: 'Created survey details',
        properties: {
          id: { type: 'string', description: 'Survey ID' },
          name: { type: 'string', description: 'Survey name' },
          description: { type: 'string', description: 'Survey description' },
          type: { type: 'string', description: 'Survey type (popover or api)' },
          questions: {
            type: 'array',
            description: 'Survey questions',
          },
          created_at: { type: 'string', description: 'Creation timestamp' },
          start_date: { type: 'string', description: 'Survey start date' },
          end_date: { type: 'string', description: 'Survey end date' },
        },
      },
    },
  }
