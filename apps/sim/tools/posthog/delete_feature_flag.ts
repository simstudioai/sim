import { getPostHogAppBaseUrl } from '@/tools/posthog/utils'
import type { ToolConfig } from '@/tools/types'

interface DeleteFeatureFlagParams {
  projectId: string
  flagId: string
  region: 'us' | 'eu'
  host?: string
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
    errorExtractor: 'posthog-errors',

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
      host: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description:
          'Self-hosted PostHog instance host (e.g., "posthog.mycompany.com"). Overrides the region setting when provided.',
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
        const baseUrl = getPostHogAppBaseUrl(params.region, params.host)
        return `${baseUrl}/api/projects/${params.projectId}/feature_flags/${params.flagId}/`
      },
      // PostHog does not allow a hard DELETE on feature flags (always returns 405).
      // Deletion is a soft-delete via PATCH with deleted: true.
      method: 'PATCH',
      headers: (params) => ({
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      }),
      body: () => ({ deleted: true }),
    },

    transformResponse: async () => {
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
