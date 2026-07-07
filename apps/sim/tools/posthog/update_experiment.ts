import { getErrorMessage } from '@sim/utils/errors'
import { getPostHogAppBaseUrl } from '@/tools/posthog/utils'
import type { ToolConfig } from '@/tools/types'

interface UpdateExperimentParams {
  projectId: string
  experimentId: string
  region?: 'us' | 'eu'
  host?: string
  apiKey: string
  name?: string
  description?: string
  parameters?: string
  filters?: string
  startDate?: string
  endDate?: string
  archived?: boolean
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
  archived: boolean
}

interface UpdateExperimentResponse {
  experiment: Experiment
}

export const updateExperimentTool: ToolConfig<UpdateExperimentParams, UpdateExperimentResponse> = {
  id: 'posthog_update_experiment',
  name: 'PostHog Update Experiment',
  description:
    'Update an existing experiment in PostHog. Use this to change dates, archive an experiment, or adjust its parameters and filters.',
  version: '1.0.0',
  errorExtractor: 'posthog-errors',

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
      description: 'The experiment ID to update (e.g., "42")',
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'PostHog cloud region: us or eu (default: us)',
      default: 'us',
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
      description: 'Updated experiment name',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated experiment description',
    },
    parameters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated experiment parameters as JSON string',
    },
    filters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated experiment filters as JSON string',
    },
    startDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated start date (ISO 8601). Set this to launch a draft experiment.',
    },
    endDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated end date (ISO 8601). Set this to conclude a running experiment.',
    },
    archived: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to archive the experiment',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = getPostHogAppBaseUrl(params.region, params.host)
      return `${baseUrl}/api/projects/${params.projectId}/experiments/${params.experimentId}/`
    },
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, any> = {}

      if (params.name !== undefined) body.name = params.name
      if (params.description !== undefined) body.description = params.description

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

      if (params.startDate !== undefined) body.start_date = params.startDate
      if (params.endDate !== undefined) body.end_date = params.endDate
      if (params.archived !== undefined) body.archived = params.archived

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
      description: 'Updated experiment',
      properties: {
        id: { type: 'number', description: 'Experiment ID' },
        name: { type: 'string', description: 'Experiment name' },
        description: { type: 'string', description: 'Experiment description' },
        feature_flag_key: { type: 'string', description: 'Associated feature flag key' },
        feature_flag: { type: 'object', description: 'Feature flag details' },
        parameters: { type: 'object', description: 'Experiment parameters' },
        filters: { type: 'object', description: 'Experiment filters' },
        start_date: { type: 'string', description: 'Start date', optional: true },
        end_date: { type: 'string', description: 'End date', optional: true },
        created_at: { type: 'string', description: 'Creation timestamp' },
        archived: { type: 'boolean', description: 'Whether the experiment is archived' },
      },
    },
  },
}
