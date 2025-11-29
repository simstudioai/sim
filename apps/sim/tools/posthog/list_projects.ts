import type { ToolConfig } from '@/tools/types'

export interface PostHogListProjectsParams {
  apiKey: string
  region?: 'us' | 'eu'
}

export interface PostHogProject {
  id: number
  uuid: string
  organization: string
  api_token: string
  app_urls: string[]
  name: string
  slack_incoming_webhook: string
  created_at: string
  updated_at: string
  anonymize_ips: boolean
  completed_snippet_onboarding: boolean
  ingested_event: boolean
  test_account_filters: any[]
  is_demo: boolean
  timezone: string
  data_attributes: string[]
}

export interface PostHogListProjectsResponse {
  success: boolean
  output: {
    projects: PostHogProject[]
  }
  error?: string
}

export const listProjectsTool: ToolConfig<PostHogListProjectsParams, PostHogListProjectsResponse> =
  {
    id: 'posthog_list_projects',
    name: 'PostHog List Projects',
    description:
      'List all projects in the organization. Returns project details including IDs, names, API tokens, and settings. Useful for getting project IDs needed by other endpoints.',
    version: '1.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'PostHog Personal API Key',
      },
      region: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Cloud region: us or eu (default: us)',
      },
    },

    request: {
      url: (params) => {
        const baseUrl = params.region === 'eu' ? 'https://eu.posthog.com' : 'https://us.posthog.com'
        return `${baseUrl}/api/projects/`
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
          projects: data.results.map((project: any) => ({
            id: project.id,
            uuid: project.uuid,
            organization: project.organization,
            api_token: project.api_token,
            app_urls: project.app_urls || [],
            name: project.name,
            slack_incoming_webhook: project.slack_incoming_webhook,
            created_at: project.created_at,
            updated_at: project.updated_at,
            anonymize_ips: project.anonymize_ips,
            completed_snippet_onboarding: project.completed_snippet_onboarding,
            ingested_event: project.ingested_event,
            test_account_filters: project.test_account_filters || [],
            is_demo: project.is_demo,
            timezone: project.timezone,
            data_attributes: project.data_attributes || [],
          })),
        },
      }
    },

    outputs: {
      projects: {
        type: 'array',
        description: 'List of projects with their configuration and settings',
        items: {
          type: 'object',
          properties: {
            id: { type: 'number', description: 'Project ID' },
            uuid: { type: 'string', description: 'Project UUID' },
            organization: { type: 'string', description: 'Organization UUID' },
            api_token: { type: 'string', description: 'Project API token for ingestion' },
            app_urls: { type: 'array', description: 'Allowed app URLs' },
            name: { type: 'string', description: 'Project name' },
            slack_incoming_webhook: {
              type: 'string',
              description: 'Slack webhook URL for notifications',
            },
            created_at: { type: 'string', description: 'Project creation timestamp' },
            updated_at: { type: 'string', description: 'Last update timestamp' },
            anonymize_ips: { type: 'boolean', description: 'Whether IP anonymization is enabled' },
            completed_snippet_onboarding: {
              type: 'boolean',
              description: 'Whether snippet onboarding is completed',
            },
            ingested_event: { type: 'boolean', description: 'Whether any event has been ingested' },
            test_account_filters: { type: 'array', description: 'Filters for test accounts' },
            is_demo: { type: 'boolean', description: 'Whether this is a demo project' },
            timezone: { type: 'string', description: 'Project timezone' },
            data_attributes: { type: 'array', description: 'Custom data attributes' },
          },
        },
      },
    },
  }
