import type { ToolConfig } from '@/tools/types'

interface GetFeatureFlagParams {
  projectId: string
  flagId: string
  region: 'us' | 'eu'
  apiKey: string
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
  usage_dashboard: number | null
  has_enriched_analytics: boolean
}

interface GetFeatureFlagResponse {
  flag: FeatureFlag
}

export const getFeatureFlagTool: ToolConfig<GetFeatureFlagParams, GetFeatureFlagResponse> = {
  id: 'posthog_get_feature_flag',
  name: 'PostHog Get Feature Flag',
  description: 'Get details of a specific feature flag',
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
      description: 'The feature flag ID (e.g., "42")',
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
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
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
      description: 'Feature flag details',
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
        usage_dashboard: {
          type: 'number',
          description: 'Usage dashboard ID',
          optional: true,
        },
        has_enriched_analytics: {
          type: 'boolean',
          description: 'Whether enriched analytics are enabled',
        },
      },
    },
  },
}
