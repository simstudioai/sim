import type { ToolConfig } from '@/tools/types'

interface CreateEarlyAccessFeatureParams {
  projectId: string
  region: 'us' | 'eu'
  apiKey: string
  name: string
  description: string
  stage?: string
  documentationUrl?: string
  featureFlagId?: number
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

interface CreateEarlyAccessFeatureResponse {
  feature: EarlyAccessFeature
}

export const createEarlyAccessFeatureTool: ToolConfig<
  CreateEarlyAccessFeatureParams,
  CreateEarlyAccessFeatureResponse
> = {
  id: 'posthog_create_early_access_feature',
  name: 'PostHog Create Early Access Feature',
  description: 'Create a new early access feature in PostHog',
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
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Feature name',
    },
    description: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Feature description',
    },
    stage: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Feature stage (e.g., alpha, beta, general-availability)',
    },
    documentationUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'URL to feature documentation',
    },
    featureFlagId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Associated feature flag ID',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.region === 'eu' ? 'https://eu.posthog.com' : 'https://us.posthog.com'
      return `${baseUrl}/api/projects/${params.projectId}/early_access_features/`
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, any> = {
        name: params.name,
        description: params.description,
      }

      if (params.stage !== undefined) {
        body.stage = params.stage
      }

      if (params.documentationUrl !== undefined) {
        body.documentation_url = params.documentationUrl
      }

      if (params.featureFlagId !== undefined) {
        body.feature_flag_id = params.featureFlagId
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        feature: data,
      },
    }
  },

  outputs: {
    feature: {
      type: 'object',
      description: 'Created early access feature',
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
}
