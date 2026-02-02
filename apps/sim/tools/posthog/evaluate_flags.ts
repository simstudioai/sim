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
  feature_flags: FlagEvaluation
  feature_flag_payloads: Record<string, any>
  errors_while_computing_flags: boolean
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
      description: 'The distinct ID of the user to evaluate flags for (e.g., "user123" or email)',
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
      feature_flags: data.featureFlags || {},
      feature_flag_payloads: data.featureFlagPayloads || {},
      errors_while_computing_flags: data.errorsWhileComputingFlags || false,
    }
  },

  outputs: {
    feature_flags: {
      type: 'object',
      description:
        'Feature flag evaluations (key-value pairs where values are boolean or string variants)',
    },
    feature_flag_payloads: {
      type: 'object',
      description: 'Additional payloads attached to feature flags',
    },
    errors_while_computing_flags: {
      type: 'boolean',
      description: 'Whether there were errors while computing flags',
    },
  },
}
