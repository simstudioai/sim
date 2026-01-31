import type { ToolConfig } from '@/tools/types'

export interface PostHogDeletePersonParams {
  personalApiKey: string
  region?: 'us' | 'eu'
  projectId: string
  personId: string
}

export interface PostHogDeletePersonResponse {
  success: boolean
  output: {
    status: string
  }
}

export const deletePersonTool: ToolConfig<PostHogDeletePersonParams, PostHogDeletePersonResponse> =
  {
    id: 'posthog_delete_person',
    name: 'PostHog Delete Person',
    description:
      'Delete a person from PostHog. This will remove all associated events and data. Use with caution.',
    version: '1.0.0',

    params: {
      personalApiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'PostHog Personal API Key (for authenticated API access)',
      },
      region: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'PostHog region: us (default) or eu',
        default: 'us',
      },
      projectId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'PostHog Project ID (e.g., "12345" or project UUID)',
      },
      personId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Person ID or UUID to delete (e.g., "01234567-89ab-cdef-0123-456789abcdef")',
      },
    },

    request: {
      url: (params) => {
        const baseUrl = params.region === 'eu' ? 'https://eu.posthog.com' : 'https://us.posthog.com'
        return `${baseUrl}/api/projects/${params.projectId}/persons/${params.personId}/`
      },
      method: 'DELETE',
      headers: (params) => ({
        Authorization: `Bearer ${params.personalApiKey}`,
        'Content-Type': 'application/json',
      }),
    },

    transformResponse: async (response: Response) => {
      if (response.ok || response.status === 204) {
        return {
          success: true,
          output: {
            status: 'Person deleted successfully',
          },
        }
      }

      const error = await response.text()
      return {
        success: false,
        output: {
          status: 'Failed to delete person',
        },
        error: error || 'Unknown error occurred',
      }
    },

    outputs: {
      status: {
        type: 'string',
        description: 'Status message indicating whether the person was deleted successfully',
      },
    },
  }
