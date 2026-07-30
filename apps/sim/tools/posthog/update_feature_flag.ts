import { getErrorMessage } from '@sim/utils/errors'
import { getPostHogAppBaseUrl } from '@/tools/posthog/utils'
import type { ToolConfig } from '@/tools/types'

interface UpdateFeatureFlagParams {
  projectId: string
  flagId: string
  region: 'us' | 'eu'
  host?: string
  apiKey: string
  name?: string
  key?: string
  filters?: string
  active?: boolean
  ensureExperienceContinuity?: boolean
  rolloutPercentage?: number
}

interface FeatureFlag {
  id: number
  name: string
  key: string
  filters: Record<string, any>
  deleted: boolean
  active: boolean
  created_at: string
  created_by: Record<string, any>
  is_simple_flag: boolean
  rollout_percentage: number | null
  ensure_experience_continuity: boolean
}

interface UpdateFeatureFlagResponse {
  flag: FeatureFlag
}

export const updateFeatureFlagTool: ToolConfig<UpdateFeatureFlagParams, UpdateFeatureFlagResponse> =
  {
    id: 'posthog_update_feature_flag',
    name: 'PostHog Update Feature Flag',
    description: 'Update an existing feature flag in PostHog',
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
        description: 'The feature flag ID (e.g., "42")',
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
      name: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Feature flag name',
      },
      key: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Feature flag key (unique identifier)',
      },
      filters: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Feature flag filters as JSON string',
      },
      active: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Whether the flag is active',
      },
      ensureExperienceContinuity: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Whether to ensure experience continuity',
      },
      rolloutPercentage: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Rollout percentage (0-100)',
      },
    },

    request: {
      url: (params) => {
        const baseUrl = getPostHogAppBaseUrl(params.region, params.host)
        return `${baseUrl}/api/projects/${params.projectId}/feature_flags/${params.flagId}/`
      },
      method: 'PATCH',
      headers: (params) => ({
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      }),
      body: (params) => {
        const body: Record<string, any> = {}

        if (params.name !== undefined) {
          body.name = params.name
        }

        if (params.key !== undefined && params.key !== '') {
          body.key = params.key
        }

        if (params.filters) {
          try {
            body.filters = JSON.parse(params.filters)
          } catch (error) {
            throw new Error(`Invalid filters JSON: ${getErrorMessage(error)}`)
          }
        }

        if (params.active !== undefined) {
          body.active = params.active
        }

        if (params.ensureExperienceContinuity !== undefined) {
          body.ensure_experience_continuity = params.ensureExperienceContinuity
        }

        if (params.rolloutPercentage !== undefined) {
          body.rollout_percentage = params.rolloutPercentage
        }

        return body
      },
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      return {
        flag: data,
      }
    },

    outputs: {
      flag: {
        type: 'object',
        description: 'Updated feature flag',
        properties: {
          id: { type: 'number', description: 'Feature flag ID' },
          name: { type: 'string', description: 'Feature flag name' },
          key: { type: 'string', description: 'Feature flag key' },
          filters: { type: 'object', description: 'Feature flag filters' },
          deleted: { type: 'boolean', description: 'Whether the flag is deleted' },
          active: { type: 'boolean', description: 'Whether the flag is active' },
          created_at: { type: 'string', description: 'Creation timestamp' },
          created_by: { type: 'object', description: 'Creator information' },
          is_simple_flag: { type: 'boolean', description: 'Whether this is a simple flag' },
          rollout_percentage: {
            type: 'number',
            description: 'Rollout percentage (if applicable)',
          },
          ensure_experience_continuity: {
            type: 'boolean',
            description: 'Whether to ensure experience continuity',
          },
        },
      },
    },
  }
