import type { ToolConfig } from '@/tools/types'

export interface PostHogGetProjectParams {
  projectId: string
  apiKey: string
  region?: 'us' | 'eu'
}

export interface PostHogProjectDetail {
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
  person_display_name_properties: string[]
  correlation_config: {
    excluded_person_property_names?: string[]
    excluded_event_names?: string[]
    excluded_event_property_names?: string[]
  }
  autocapture_opt_out: boolean
  autocapture_exceptions_opt_in: boolean
  session_recording_opt_in: boolean
  capture_console_log_opt_in: boolean
  capture_performance_opt_in: boolean
}

export interface PostHogGetProjectResponse {
  success: boolean
  output: {
    project: PostHogProjectDetail
  }
  error?: string
}

export const getProjectTool: ToolConfig<PostHogGetProjectParams, PostHogGetProjectResponse> = {
  id: 'posthog_get_project',
  name: 'PostHog Get Project',
  description:
    'Get detailed information about a specific project by ID. Returns comprehensive project configuration, settings, and feature flags.',
  version: '1.0.0',

  params: {
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Project ID (e.g., "12345" or project UUID)',
    },
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
      return `${baseUrl}/api/projects/${params.projectId}/`
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
        project: {
          id: data.id,
          uuid: data.uuid,
          organization: data.organization,
          api_token: data.api_token,
          app_urls: data.app_urls || [],
          name: data.name,
          slack_incoming_webhook: data.slack_incoming_webhook,
          created_at: data.created_at,
          updated_at: data.updated_at,
          anonymize_ips: data.anonymize_ips,
          completed_snippet_onboarding: data.completed_snippet_onboarding,
          ingested_event: data.ingested_event,
          test_account_filters: data.test_account_filters || [],
          is_demo: data.is_demo,
          timezone: data.timezone,
          data_attributes: data.data_attributes || [],
          person_display_name_properties: data.person_display_name_properties || [],
          correlation_config: data.correlation_config || {},
          autocapture_opt_out: data.autocapture_opt_out,
          autocapture_exceptions_opt_in: data.autocapture_exceptions_opt_in,
          session_recording_opt_in: data.session_recording_opt_in,
          capture_console_log_opt_in: data.capture_console_log_opt_in,
          capture_performance_opt_in: data.capture_performance_opt_in,
        },
      },
    }
  },

  outputs: {
    project: {
      type: 'object',
      description: 'Detailed project information with all configuration settings',
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
        person_display_name_properties: {
          type: 'array',
          description: 'Properties used for person display names',
        },
        correlation_config: {
          type: 'object',
          description: 'Configuration for correlation analysis',
        },
        autocapture_opt_out: { type: 'boolean', description: 'Whether autocapture is disabled' },
        autocapture_exceptions_opt_in: {
          type: 'boolean',
          description: 'Whether exception autocapture is enabled',
        },
        session_recording_opt_in: {
          type: 'boolean',
          description: 'Whether session recording is enabled',
        },
        capture_console_log_opt_in: {
          type: 'boolean',
          description: 'Whether console log capture is enabled',
        },
        capture_performance_opt_in: {
          type: 'boolean',
          description: 'Whether performance capture is enabled',
        },
      },
    },
  },
}
