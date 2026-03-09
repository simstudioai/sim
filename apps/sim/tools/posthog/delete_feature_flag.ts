import type { ToolConfig } from '@/tools/types'

interface DeleteFeatureFlagParams {
  projectId: string
  flagId: string
  region: 'us' | 'eu'
  apiKey: string
}

interface DeleteFeatureFlagResponse {
  success: boolean
  message: string
}

export const deleteFeatureFlagTool: ToolConfig<DeleteFeatureFlagParams, DeleteFeatureFlagResponse> =
  {
    id: 'posthog_delete_feature_flag',
    name: 'PostHog Delete Feature Flag',
    description: 'Delete a feature flag from PostHog',
    version: '1.0.0',

    params: {
      projectId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The PostHog project ID (e.g., "12345" or project UUID)',
      },
      flagId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The feature flag ID to delete (e.g., "42")',
      },
      region: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'PostHog cloud region: us or eu',
      },
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'PostHog Personal API Key',
      },
    },

    request: {
      url: (params) => {
        const baseUrl = params.region === 'eu' ? 'https://eu.posthog.com' : 'https://us.posthog.com'
        return `${baseUrl}/api/projects/${params.projectId}/feature_flags/${params.flagId}`
      },
      method: 'DELETE',
      headers: (params) => ({
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      }),
    },

    transformResponse: async (response: Response) => {
      return {
        success: true,
        message: 'Feature flag deleted successfully',
      }
    },

    outputs: {
      success: {
        type: 'boolean',
        description: 'Whether the deletion was successful',
      },
      message: {
        type: 'string',
        description: 'Confirmation message',
      },
    },
  }
