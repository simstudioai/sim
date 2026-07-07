import { getPostHogAppBaseUrl } from '@/tools/posthog/utils'
import type { ToolConfig } from '@/tools/types'

interface ListFeatureFlagsParams {
  projectId: string
  region: 'us' | 'eu'
  host?: string
  apiKey: string
  limit?: number
  offset?: number
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

interface ListFeatureFlagsResponse {
  results: FeatureFlag[]
  count: number
  next: string | null
  previous: string | null
}

export const listFeatureFlagsTool: ToolConfig<ListFeatureFlagsParams, ListFeatureFlagsResponse> = {
  id: 'posthog_list_feature_flags',
  name: 'PostHog List Feature Flags',
  description: 'List all feature flags in a PostHog project',
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
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to return (e.g., 10, 50, 100)',
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
      const baseUrl = getPostHogAppBaseUrl(params.region, params.host)
      const url = new URL(`${baseUrl}/api/projects/${params.projectId}/feature_flags/`)

      if (params.limit) url.searchParams.append('limit', String(params.limit))
      if (params.offset) url.searchParams.append('offset', String(params.offset))

      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const error = await response.text()
      throw new Error(error || 'Failed to list feature flags')
    }

    const data = await response.json()

    return {
      results: data.results,
      count: data.count,
      next: data.next ?? null,
      previous: data.previous ?? null,
    }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'List of feature flags',
      items: {
        type: 'object',
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
            optional: true,
          },
          ensure_experience_continuity: {
            type: 'boolean',
            description: 'Whether to ensure experience continuity',
          },
        },
      },
    },
    count: {
      type: 'number',
      description: 'Total number of feature flags',
    },
    next: {
      type: 'string',
      description: 'URL to next page of results',
      optional: true,
    },
    previous: {
      type: 'string',
      description: 'URL to previous page of results',
      optional: true,
    },
  },
}
