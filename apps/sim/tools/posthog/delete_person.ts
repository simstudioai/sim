import { getPostHogAppBaseUrl } from '@/tools/posthog/utils'
import type { ToolConfig } from '@/tools/types'

export interface PostHogDeletePersonParams {
  apiKey: string
  region?: 'us' | 'eu'
  host?: string
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
    errorExtractor: 'posthog-errors',

    params: {
      apiKey: {
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
      host: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description:
          'Self-hosted PostHog instance host (e.g., "posthog.mycompany.com"). Overrides the region setting when provided.',
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
      // PostHog has no single-person DELETE endpoint; deletion is only available
      // via the bulk_delete endpoint, called here with a single ID.
      url: (params) => {
        const baseUrl = getPostHogAppBaseUrl(params.region, params.host)
        return `${baseUrl}/api/projects/${params.projectId}/persons/bulk_delete/`
      },
      method: 'POST',
      headers: (params) => ({
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      }),
      body: (params) => ({ ids: [params.personId] }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()
      return {
        success: true,
        output: {
          status:
            data.persons_deleted > 0
              ? 'Person deleted successfully'
              : 'No matching person found to delete',
        },
      }
    },

    outputs: {
      status: {
        type: 'string',
        description: 'Status message indicating whether the person was deleted successfully',
      },
    },
  }
