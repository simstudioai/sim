import { getErrorMessage } from '@sim/utils/errors'
import { getPostHogAppBaseUrl, postHogPathSegment } from '@/tools/posthog/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface CreateFeatureFlagParams {
  projectId: string
  region: 'us' | 'eu'
  host?: string
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

/**
 * The rollout percentage the caller set, or `undefined` when the field is empty. An empty
 * field arrives as `null` or blank text, and PostHog reads a null rollout as 100%, so it must
 * send no release condition. A canvas value arrives as text, so numeric text is accepted.
 */
function parseRolloutPercentage(value: unknown): number | undefined {
  if (value == null || (typeof value === 'string' && !value.trim())) return undefined
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new Error('Rollout percentage must be a number from 0 to 100')
  }
  return parsed
}

export const createFeatureFlagTool: ToolConfig<
  CreateFeatureFlagParams,
  ToolResponse & { output: CreateFeatureFlagResponse }
> = {
  id: 'posthog_create_feature_flag',
  name: 'PostHog Create Feature Flag',
  description: 'Create a new feature flag in PostHog',
  version: '1.0.0',
  errorExtractor: 'posthog-errors',

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
      description:
        'Percentage of users (0-100) the flag is released to. With Filters, applies to each group that sets no rollout_percentage of its own.',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = getPostHogAppBaseUrl(params.region, params.host)
      return `${baseUrl}/api/projects/${postHogPathSegment(params.projectId, 'projectId')}/feature_flags/`
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

      const rolloutPercentage = parseRolloutPercentage(params.rolloutPercentage)
      if (rolloutPercentage !== undefined) {
        if (body.filters === undefined) {
          body.filters = {
            groups: [{ properties: [], rollout_percentage: rolloutPercentage }],
          }
        } else if (Array.isArray(body.filters?.groups)) {
          for (const group of body.filters.groups) {
            if (group && group.rollout_percentage === undefined) {
              group.rollout_percentage = rolloutPercentage
            }
          }
        } else {
          throw new Error('Rollout percentage needs Filters with a groups array')
        }
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        flag: data,
      },
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
