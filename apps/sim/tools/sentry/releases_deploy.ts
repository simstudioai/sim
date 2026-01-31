import type { SentryCreateDeployParams, SentryCreateDeployResponse } from '@/tools/sentry/types'
import type { ToolConfig } from '@/tools/types'

export const createDeployTool: ToolConfig<SentryCreateDeployParams, SentryCreateDeployResponse> = {
  id: 'sentry_releases_deploy',
  name: 'Create Deploy',
  description:
    'Create a deploy record for a Sentry release in a specific environment. Deploys track when and where releases are deployed. Returns the created deploy details.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sentry API authentication token',
    },
    organizationSlug: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The slug of the organization (e.g., "my-org")',
    },
    version: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Version identifier of the release being deployed (e.g., "1.0.0" or "abc123")',
    },
    environment: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Environment name where the release is being deployed (e.g., "production", "staging")',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional name for this deploy (e.g., "Deploy v2.0 to Production")',
    },
    url: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'URL pointing to the deploy (e.g., CI/CD pipeline URL)',
    },
    dateStarted: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'ISO 8601 timestamp for when the deploy started (defaults to current time)',
    },
    dateFinished: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'ISO 8601 timestamp for when the deploy finished',
    },
  },

  request: {
    url: (params) =>
      `https://sentry.io/api/0/organizations/${params.organizationSlug}/releases/${encodeURIComponent(params.version)}/deploys/`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, any> = {
        environment: params.environment,
      }

      if (params.name && params.name !== null && params.name !== '') {
        body.name = params.name
      }

      if (params.url && params.url !== null && params.url !== '') {
        body.url = params.url
      }

      if (params.dateStarted && params.dateStarted !== null && params.dateStarted !== '') {
        body.dateStarted = params.dateStarted
      }

      if (params.dateFinished && params.dateFinished !== null && params.dateFinished !== '') {
        body.dateFinished = params.dateFinished
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const deploy = await response.json()

    return {
      success: true,
      output: {
        deploy: {
          id: deploy.id,
          environment: deploy.environment,
          name: deploy.name ?? null,
          url: deploy.url ?? null,
          dateStarted: deploy.dateStarted,
          dateFinished: deploy.dateFinished ?? null,
        },
      },
    }
  },

  outputs: {
    deploy: {
      type: 'object',
      description: 'The newly created deploy record',
      properties: {
        id: { type: 'string', description: 'Unique deploy ID' },
        environment: {
          type: 'string',
          description: 'Environment name where the release was deployed',
        },
        name: { type: 'string', description: 'Name of the deploy', optional: true },
        url: { type: 'string', description: 'URL pointing to the deploy', optional: true },
        dateStarted: {
          type: 'string',
          description: 'When the deploy started (ISO timestamp)',
        },
        dateFinished: {
          type: 'string',
          description: 'When the deploy finished (ISO timestamp)',
          optional: true,
        },
      },
    },
  },
}
