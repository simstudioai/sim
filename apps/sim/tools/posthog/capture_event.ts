import type { ToolConfig } from '@/tools/types'

export interface PostHogCaptureEventParams {
  projectApiKey: string
  region?: 'us' | 'eu'
  event: string
  distinctId: string
  properties?: string
  timestamp?: string
}

export interface PostHogCaptureEventResponse {
  success: boolean
  output: {
    status: string
  }
}

export const captureEventTool: ToolConfig<PostHogCaptureEventParams, PostHogCaptureEventResponse> =
  {
    id: 'posthog_capture_event',
    name: 'PostHog Capture Event',
    description:
      'Capture a single event in PostHog. Use this to track user actions, page views, or custom events.',
    version: '1.0.0',

    params: {
      projectApiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'PostHog Project API Key (public token for event ingestion)',
      },
      region: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'PostHog region: us (default) or eu',
        default: 'us',
      },
      event: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The name of the event to capture (e.g., "page_view", "button_clicked")',
      },
      distinctId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description:
          'Unique identifier for the user or device (e.g., "user123", email, or device UUID)',
      },
      properties: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'JSON string of event properties (e.g., {"button_name": "signup", "page": "homepage"})',
      },
      timestamp: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'ISO 8601 timestamp for when the event occurred. If not provided, uses current time',
      },
    },

    request: {
      url: (params) => {
        const baseUrl =
          params.region === 'eu' ? 'https://eu.i.posthog.com' : 'https://us.i.posthog.com'
        return `${baseUrl}/capture/`
      },
      method: 'POST',
      headers: (params) => ({
        'Content-Type': 'application/json',
      }),
      body: (params) => {
        const body: Record<string, any> = {
          api_key: params.projectApiKey,
          event: params.event,
          distinct_id: params.distinctId,
        }

        if (params.properties) {
          try {
            body.properties = JSON.parse(params.properties)
          } catch (e) {
            body.properties = {}
          }
        }

        if (params.timestamp) {
          body.timestamp = params.timestamp
        }

        return body
      },
    },

    transformResponse: async (response: Response) => {
      if (response.ok) {
        return {
          success: true,
          output: {
            status: 'Event captured successfully',
          },
        }
      }

      const error = await response.text()
      return {
        success: false,
        output: {
          status: 'Failed to capture event',
        },
        error: error || 'Unknown error occurred',
      }
    },

    outputs: {
      status: {
        type: 'string',
        description: 'Status message indicating whether the event was captured successfully',
      },
    },
  }
