import { getErrorMessage } from '@sim/utils/errors'
import { getPostHogAppBaseUrl } from '@/tools/posthog/utils'
import type { ToolConfig } from '@/tools/types'

interface CreateExperimentParams {
  projectId: string
  region: 'us' | 'eu'
  host?: string
  apiKey: string
  name: string
  description?: string
  featureFlagKey: string
  parameters?: string
  filters?: string
  startDate?: string
  endDate?: string
}

interface Experiment {
  id: number
  name: string
  description: string
  feature_flag_key: string
  feature_flag: Record<string, any>
  parameters: Record<string, any>
  filters: Record<string, any>
  start_date: string | null
  end_date: string | null
  created_at: string
  created_by: Record<string, any>
  archived: boolean
}

interface CreateExperimentResponse {
  experiment: Experiment
}

export const createExperimentTool: ToolConfig<CreateExperimentParams, CreateExperimentResponse> = {
  id: 'posthog_create_experiment',
  name: 'PostHog Create Experiment',
  description: 'Create a new experiment in PostHog',
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
      required: true,
      visibility: 'user-or-llm',
      description: 'Experiment name',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Experiment description',
    },
    featureFlagKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Feature flag key to use for the experiment',
    },
    parameters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Experiment parameters as JSON string',
    },
    filters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Experiment filters as JSON string',
    },
    startDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Experiment start date (ISO format)',
    },
    endDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Experiment end date (ISO format)',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = getPostHogAppBaseUrl(params.region, params.host)
      return `${baseUrl}/api/projects/${params.projectId}/experiments/`
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, any> = {
        name: params.name,
        feature_flag_key: params.featureFlagKey,
      }

      if (params.description !== undefined) {
        body.description = params.description
      }

      if (params.parameters) {
        try {
          body.parameters = JSON.parse(params.parameters)
        } catch (error) {
          throw new Error(`Invalid parameters JSON: ${getErrorMessage(error)}`)
        }
      }

      if (params.filters) {
        try {
          body.filters = JSON.parse(params.filters)
        } catch (error) {
          throw new Error(`Invalid filters JSON: ${getErrorMessage(error)}`)
        }
      }

      if (params.startDate !== undefined) {
        body.start_date = params.startDate
      }

      if (params.endDate !== undefined) {
        body.end_date = params.endDate
      }

      return body
    },
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
      description: 'Created experiment',
      properties: {
        id: { type: 'number', description: 'Experiment ID' },
        name: { type: 'string', description: 'Experiment name' },
        description: { type: 'string', description: 'Experiment description' },
        feature_flag_key: { type: 'string', description: 'Associated feature flag key' },
        feature_flag: { type: 'object', description: 'Feature flag details' },
        parameters: { type: 'object', description: 'Experiment parameters' },
        filters: { type: 'object', description: 'Experiment filters' },
        start_date: { type: 'string', description: 'Start date' },
        end_date: { type: 'string', description: 'End date' },
        created_at: { type: 'string', description: 'Creation timestamp' },
        created_by: { type: 'object', description: 'Creator information' },
        archived: { type: 'boolean', description: 'Whether the experiment is archived' },
      },
    },
  },
}
