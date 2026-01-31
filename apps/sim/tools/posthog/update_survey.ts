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

interface PostHogUpdateSurveyParams {
  apiKey: string
  projectId: string
  surveyId: string
  region?: 'us' | 'eu'
  name?: string
  description?: string
  type?: 'popover' | 'api'
  questions?: string // JSON string of questions array
  startDate?: string
  endDate?: string
  appearance?: string // JSON string of appearance config
  conditions?: string // JSON string of conditions
  targetingFlagFilters?: string // JSON string of targeting filters
  linkedFlagId?: string
  responsesLimit?: number
  archived?: boolean
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

interface PostHogUpdateSurveyResponse {
  success: boolean
  output: {
    survey: PostHogSurvey
  }
}

export const updateSurveyTool: ToolConfig<PostHogUpdateSurveyParams, PostHogUpdateSurveyResponse> =
  {
    id: 'posthog_update_survey',
    name: 'PostHog Update Survey',
    description:
      'Update an existing survey in PostHog. Can modify questions, appearance, conditions, and other settings.',
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
        description: 'Survey ID to update (e.g., "01234567-89ab-cdef-0123-456789abcdef")',
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
        description: 'Survey name',
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
        description: 'Survey type: popover or api',
      },
      questions: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'JSON string of survey questions array. Each question must have type (open/link/rating/multiple_choice) and question text.',
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
      archived: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Archive or unarchive the survey',
      },
    },

    request: {
      url: (params) => {
        const baseUrl = params.region === 'eu' ? 'https://eu.posthog.com' : 'https://us.posthog.com'
        return `${baseUrl}/api/projects/${params.projectId}/surveys/${params.surveyId}/`
      },
      method: 'PATCH',
      headers: (params) => ({
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      }),
      body: (params) => {
        const body: Record<string, any> = {}

        if (params.name !== undefined) body.name = params.name
        if (params.description !== undefined) body.description = params.description
        if (params.type !== undefined) body.type = params.type
        if (params.questions) body.questions = JSON.parse(params.questions)
        if (params.startDate !== undefined) body.start_date = params.startDate
        if (params.endDate !== undefined) body.end_date = params.endDate
        if (params.appearance) body.appearance = JSON.parse(params.appearance)
        if (params.conditions) body.conditions = JSON.parse(params.conditions)
        if (params.targetingFlagFilters) {
          body.targeting_flag_filters = JSON.parse(params.targetingFlagFilters)
        }
        if (params.linkedFlagId !== undefined && params.linkedFlagId !== '') {
          body.linked_flag_id = params.linkedFlagId
        }
        if (params.responsesLimit !== undefined) body.responses_limit = params.responsesLimit
        if (params.archived !== undefined) body.archived = params.archived

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
        description: 'Updated survey details',
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
          archived: { type: 'boolean', description: 'Whether survey is archived' },
        },
      },
    },
  }
