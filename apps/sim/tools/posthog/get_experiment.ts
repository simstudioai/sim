import type { ToolConfig } from '@/tools/types'

interface GetExperimentParams {
  projectId: string
  experimentId: string
  region: 'us' | 'eu'
  apiKey: string
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
  metrics: Array<Record<string, any>>
  metrics_secondary: Array<Record<string, any>>
}

interface GetExperimentResponse {
  experiment: Experiment
}

export const getExperimentTool: ToolConfig<GetExperimentParams, GetExperimentResponse> = {
  id: 'posthog_get_experiment',
  name: 'PostHog Get Experiment',
  description: 'Get details of a specific experiment',
  version: '1.0.0',

  params: {
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The PostHog project ID (e.g., "12345" or project UUID)',
    },
    experimentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The experiment ID (e.g., "42")',
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
      return `${baseUrl}/api/projects/${params.projectId}/experiments/${params.experimentId}`
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
      experiment: data,
    }
  },

  outputs: {
    experiment: {
      type: 'object',
      description: 'Experiment details',
      properties: {
        id: { type: 'number', description: 'Experiment ID' },
        name: { type: 'string', description: 'Experiment name' },
        description: { type: 'string', description: 'Experiment description' },
        feature_flag_key: { type: 'string', description: 'Associated feature flag key' },
        feature_flag: { type: 'object', description: 'Feature flag details' },
        parameters: { type: 'object', description: 'Experiment parameters' },
        filters: { type: 'object', description: 'Experiment filters' },
        variants: { type: 'object', description: 'Experiment variants' },
        start_date: { type: 'string', description: 'Start date' },
        end_date: { type: 'string', description: 'End date' },
        created_at: { type: 'string', description: 'Creation timestamp' },
        created_by: { type: 'object', description: 'Creator information' },
        archived: { type: 'boolean', description: 'Whether the experiment is archived' },
        metrics: { type: 'array', description: 'Primary metrics' },
        metrics_secondary: { type: 'array', description: 'Secondary metrics' },
      },
    },
  },
}
