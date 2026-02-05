import type { ToolConfig } from '@/tools/types'

interface PostHogListSessionRecordingsParams {
  apiKey: string
  projectId: string
  region?: 'us' | 'eu'
  limit?: number
  offset?: number
}

interface PostHogSessionRecording {
  id: string
  distinct_id: string
  viewed: boolean
  recording_duration: number
  active_seconds: number
  inactive_seconds: number
  start_time: string
  end_time: string
  click_count: number
  keypress_count: number
  console_log_count: number
  console_warn_count: number
  console_error_count: number
  person?: {
    id: string
    name?: string
    properties?: Record<string, any>
  }
}

interface PostHogListSessionRecordingsResponse {
  success: boolean
  output: {
    recordings: PostHogSessionRecording[]
    count: number
    next?: string
    previous?: string
  }
}

export const listSessionRecordingsTool: ToolConfig<
  PostHogListSessionRecordingsParams,
  PostHogListSessionRecordingsResponse
> = {
  id: 'posthog_list_session_recordings',
  name: 'PostHog List Session Recordings',
  description:
    'List session recordings in a PostHog project. Session recordings capture user interactions with your application.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PostHog Personal API Key',
    },
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'PostHog Project ID (e.g., "12345" or project UUID)',
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'PostHog cloud region: us or eu (default: us)',
      default: 'us',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to return (default: 50, e.g., 10, 25, 50)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to skip for pagination (e.g., 0, 50, 100)',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.region === 'eu' ? 'https://eu.posthog.com' : 'https://us.posthog.com'
      const url = new URL(`${baseUrl}/api/projects/${params.projectId}/session_recordings/`)

      if (params.limit) {
        url.searchParams.set('limit', params.limit.toString())
      }
      if (params.offset) {
        url.searchParams.set('offset', params.offset.toString())
      }

      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        recordings: data.results || [],
        count: data.count || 0,
        next: data.next ?? null,
        previous: data.previous ?? null,
      },
    }
  },

  outputs: {
    recordings: {
      type: 'array',
      description: 'List of session recordings',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Recording ID' },
          distinct_id: { type: 'string', description: 'User distinct ID' },
          viewed: { type: 'boolean', description: 'Whether recording has been viewed' },
          recording_duration: { type: 'number', description: 'Recording duration in seconds' },
          active_seconds: { type: 'number', description: 'Active time in seconds' },
          inactive_seconds: { type: 'number', description: 'Inactive time in seconds' },
          start_time: { type: 'string', description: 'Recording start timestamp' },
          end_time: { type: 'string', description: 'Recording end timestamp' },
          click_count: { type: 'number', description: 'Number of clicks' },
          keypress_count: { type: 'number', description: 'Number of keypresses' },
          console_log_count: { type: 'number', description: 'Number of console logs' },
          console_warn_count: { type: 'number', description: 'Number of console warnings' },
          console_error_count: { type: 'number', description: 'Number of console errors' },
          person: { type: 'object', description: 'Person information' },
        },
      },
    },
    count: {
      type: 'number',
      description: 'Total number of recordings',
    },
    next: {
      type: 'string',
      description: 'URL for next page of results',
      optional: true,
    },
    previous: {
      type: 'string',
      description: 'URL for previous page of results',
      optional: true,
    },
  },
}
