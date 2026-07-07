import { getPostHogAppBaseUrl } from '@/tools/posthog/utils'
import type { ToolConfig } from '@/tools/types'

interface PostHogDeleteSurveyParams {
  apiKey: string
  projectId: string
  surveyId: string
  region?: 'us' | 'eu'
  host?: string
}

interface PostHogDeleteSurveyResponse {
  success: boolean
  output: {
    status: string
  }
}

export const deleteSurveyTool: ToolConfig<PostHogDeleteSurveyParams, PostHogDeleteSurveyResponse> =
  {
    id: 'posthog_delete_survey',
    name: 'PostHog Delete Survey',
    description: 'Delete a survey from PostHog. Use this to remove expired or unused surveys.',
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
        description: 'Survey ID to delete (e.g., "01234567-89ab-cdef-0123-456789abcdef")',
      },
      region: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'PostHog cloud region: us or eu (default: us)',
        default: 'us',
      },
      host: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description:
          'Self-hosted PostHog instance host (e.g., "posthog.mycompany.com"). Overrides the region setting when provided.',
      },
    },

    request: {
      url: (params) => {
        const baseUrl = getPostHogAppBaseUrl(params.region, params.host)
        return `${baseUrl}/api/projects/${params.projectId}/surveys/${params.surveyId}/`
      },
      method: 'DELETE',
      headers: (params) => ({
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      }),
    },

    transformResponse: async (response: Response) => {
      if (response.ok || response.status === 204) {
        return {
          success: true,
          output: {
            status: 'Survey deleted successfully',
          },
        }
      }

      const error = await response.text()
      return {
        success: false,
        output: {
          status: 'Failed to delete survey',
        },
        error: error || 'Unknown error occurred',
      }
    },

    outputs: {
      status: {
        type: 'string',
        description: 'Status message indicating whether the survey was deleted successfully',
      },
    },
  }
