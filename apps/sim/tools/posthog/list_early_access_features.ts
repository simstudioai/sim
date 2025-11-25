import type { ToolConfig } from '@/tools/types'

interface ListEarlyAccessFeaturesParams {
  projectId: string
  region: 'us' | 'eu'
  apiKey: string
  limit?: number
  offset?: number
}

interface EarlyAccessFeature {
  id: string
  name: string
  description: string
  stage: string
  documentation_url: string | null
  feature_flag: Record<string, any>
  created_at: string
}

interface ListEarlyAccessFeaturesResponse {
  results: EarlyAccessFeature[]
  count: number
  next: string | null
  previous: string | null
}

export const listEarlyAccessFeaturesTool: ToolConfig<
  ListEarlyAccessFeaturesParams,
  ListEarlyAccessFeaturesResponse
> = {
  id: 'posthog_list_early_access_features',
  name: 'PostHog List Early Access Features',
  description: 'List all early access features in a PostHog project',
  version: '1.0.0',

  params: {
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The PostHog project ID',
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
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Number of results to return',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Number of results to skip',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.region === 'eu' ? 'https://eu.posthog.com' : 'https://us.posthog.com'
      const url = new URL(`${baseUrl}/api/projects/${params.projectId}/early_access_features/`)

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
    const data = await response.json()

    return {
      success: true,
      output: {
        results: data.results,
        count: data.count,
        next: data.next,
        previous: data.previous,
      },
    }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'List of early access features',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Early access feature ID' },
          name: { type: 'string', description: 'Feature name' },
          description: { type: 'string', description: 'Feature description' },
          stage: { type: 'string', description: 'Feature stage (alpha, beta, etc.)' },
          documentation_url: {
            type: 'string',
            description: 'URL to feature documentation',
          },
          feature_flag: { type: 'object', description: 'Associated feature flag' },
          created_at: { type: 'string', description: 'Creation timestamp' },
        },
      },
    },
    count: {
      type: 'number',
      description: 'Total number of early access features',
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
