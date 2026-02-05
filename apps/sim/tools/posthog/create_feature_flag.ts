import type { ToolConfig } from '@/tools/types'

interface CreateFeatureFlagParams {
  projectId: string
  region: 'us' | 'eu'
  apiKey: string
  name: string
  key: string
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

interface CreateFeatureFlagResponse {
  flag: FeatureFlag
}

export const createFeatureFlagTool: ToolConfig<CreateFeatureFlagParams, CreateFeatureFlagResponse> =
  {
    id: 'posthog_create_feature_flag',
    name: 'PostHog Create Feature Flag',
    description: 'Create a new feature flag in PostHog',
    version: '1.0.0',

    params: {
      projectId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The PostHog project ID (e.g., "12345" or project UUID)',
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
      name: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Feature flag name (optional - can be empty)',
      },
      key: {
        type: 'string',
        required: true,
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
        description: 'Whether the flag is active (default: true)',
        default: true,
      },
      ensureExperienceContinuity: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Whether to ensure experience continuity (default: false)',
        default: false,
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
        const baseUrl = params.region === 'eu' ? 'https://eu.posthog.com' : 'https://us.posthog.com'
        return `${baseUrl}/api/projects/${params.projectId}/feature_flags/`
      },
      method: 'POST',
      headers: (params) => ({
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      }),
      body: (params) => {
        const body: Record<string, any> = {
          name: params.name,
          key: params.key,
        }

        if (params.filters) {
          try {
            body.filters = JSON.parse(params.filters)
          } catch {
            body.filters = {}
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
        description: 'Created feature flag',
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
