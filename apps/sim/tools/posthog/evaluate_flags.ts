import type { ToolConfig } from '@/tools/types'

interface EvaluateFlagsParams {
  region: 'us' | 'eu'
  projectApiKey: string
  distinctId: string
  groups?: string
  personProperties?: string
  groupProperties?: string
}

interface FlagEvaluation {
  [key: string]: boolean | string
}

interface EvaluateFlagsResponse {
  featureFlags: FlagEvaluation
  featureFlagPayloads: Record<string, any>
  errorsWhileComputingFlags: boolean
}

export const evaluateFlagsTool: ToolConfig<EvaluateFlagsParams, EvaluateFlagsResponse> = {
  id: 'posthog_evaluate_flags',
  name: 'PostHog Evaluate Feature Flags',
  description:
    'Evaluate feature flags for a specific user or group. This is a public endpoint that uses the project API key.',
  version: '1.0.0',

  params: {
    region: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PostHog cloud region: us or eu',
    },
    projectApiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PostHog Project API Key (not personal API key)',
    },
    distinctId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The distinct ID of the user to evaluate flags for',
    },
    groups: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Groups as JSON string (e.g., {"company": "company_id_in_your_db"})',
    },
    personProperties: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Person properties as JSON string',
    },
    groupProperties: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Group properties as JSON string',
    },
  },

  request: {
    url: (params) => {
      const baseUrl =
        params.region === 'eu' ? 'https://eu.i.posthog.com' : 'https://us.i.posthog.com'
      return `${baseUrl}/decide?v=3`
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.projectApiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, any> = {
        distinct_id: params.distinctId,
      }

      if (params.groups) {
        try {
          body.groups = JSON.parse(params.groups)
        } catch {
          body.groups = {}
        }
      }

      if (params.personProperties) {
        try {
          body.person_properties = JSON.parse(params.personProperties)
        } catch {
          body.person_properties = {}
        }
      }

      if (params.groupProperties) {
        try {
          body.group_properties = JSON.parse(params.groupProperties)
        } catch {
          body.group_properties = {}
        }
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      featureFlags: data.featureFlags || {},
      featureFlagPayloads: data.featureFlagPayloads || {},
      errorsWhileComputingFlags: data.errorsWhileComputingFlags || false,
    }
  },

  outputs: {
    featureFlags: {
      type: 'object',
      description:
        'Feature flag evaluations (key-value pairs where values are boolean or string variants)',
    },
    featureFlagPayloads: {
      type: 'object',
      description: 'Additional payloads attached to feature flags',
    },
    errorsWhileComputingFlags: {
      type: 'boolean',
      description: 'Whether there were errors while computing flags',
    },
  },
}
