import { getPostHogAppBaseUrl } from '@/tools/posthog/utils'
import type { ToolConfig } from '@/tools/types'

interface ListExperimentsParams {
  projectId: string
  region: 'us' | 'eu'
  host?: string
  apiKey: string
  limit?: number
  offset?: number
}

interface Experiment {
  id: number
  name: string
  description: string
  feature_flag_key: string
  feature_flag: Record<string, any>
  parameters: Record<string, any>
  filters: Record<string, any>
  variants: Record<string, any>
  start_date: string | null
  end_date: string | null
  created_at: string
  created_by: Record<string, any>
  archived: boolean
}

interface ListExperimentsResponse {
  results: Experiment[]
  count: number
  next: string | null
  previous: string | null
}

export const listExperimentsTool: ToolConfig<ListExperimentsParams, ListExperimentsResponse> = {
  id: 'posthog_list_experiments',
  name: 'PostHog List Experiments',
  description: 'List all experiments in a PostHog project',
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
      const url = new URL(`${baseUrl}/api/projects/${params.projectId}/experiments/`)

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
      throw new Error(error || 'Failed to list experiments')
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
      description: 'List of experiments',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Experiment ID' },
          name: { type: 'string', description: 'Experiment name' },
          description: { type: 'string', description: 'Experiment description' },
          feature_flag_key: { type: 'string', description: 'Associated feature flag key' },
          feature_flag: { type: 'object', description: 'Feature flag details' },
          parameters: { type: 'object', description: 'Experiment parameters' },
          filters: { type: 'object', description: 'Experiment filters' },
          variants: { type: 'object', description: 'Experiment variants' },
          start_date: { type: 'string', description: 'Start date', optional: true },
          end_date: { type: 'string', description: 'End date', optional: true },
          created_at: { type: 'string', description: 'Creation timestamp' },
          created_by: { type: 'object', description: 'Creator information' },
          archived: { type: 'boolean', description: 'Whether the experiment is archived' },
        },
      },
    },
    count: {
      type: 'number',
      description: 'Total number of experiments',
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
