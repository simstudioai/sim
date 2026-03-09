import type { ToolConfig } from '@/tools/types'

interface PostHogListSurveysParams {
  apiKey: string
  projectId: string
  region?: 'us' | 'eu'
  limit?: number
  offset?: number
}

interface PostHogSurvey {
  id: string
  name: string
  description: string
  type: 'popover' | 'api'
  questions: Array<{
    type: 'open' | 'link' | 'rating' | 'multiple_choice'
    question: string
    description?: string
    choices?: string[]
    scale?: number
  }>
  appearance?: Record<string, any>
  conditions?: Record<string, any>
  created_at: string
  created_by: Record<string, any>
  start_date?: string
  end_date?: string
  archived?: boolean
}

interface PostHogListSurveysResponse {
  success: boolean
  output: {
    surveys: PostHogSurvey[]
    count: number
    next?: string
    previous?: string
  }
}

export const listSurveysTool: ToolConfig<PostHogListSurveysParams, PostHogListSurveysResponse> = {
  id: 'posthog_list_surveys',
  name: 'PostHog List Surveys',
  description:
    'List all surveys in a PostHog project. Surveys allow you to collect feedback from users.',
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
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to return (default: 100, e.g., 10, 50, 100)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to skip for pagination (e.g., 0, 100, 200)',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.region === 'eu' ? 'https://eu.posthog.com' : 'https://us.posthog.com'
      const url = new URL(`${baseUrl}/api/projects/${params.projectId}/surveys/`)

      if (params.limit) {
        url.searchParams.set('limit', params.limit.toString())
      }
      if (params.offset) {
        url.searchParams.set('offset', params.offset.toString())
      }

      return url.toString()
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
        surveys: data.results || [],
        count: data.count || 0,
        next: data.next ?? null,
        previous: data.previous ?? null,
      },
    }
  },

  outputs: {
    surveys: {
      type: 'array',
      description: 'List of surveys in the project',
      items: {
        type: 'object',
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
    count: {
      type: 'number',
      description: 'Total number of surveys',
    },
    next: {
      type: 'string',
      description: 'URL for next page of results',
      optional: true,
    },
    previous: {
      type: 'string',
      description: 'URL for previous page of results',
      optional: true,
    },
  },
}
