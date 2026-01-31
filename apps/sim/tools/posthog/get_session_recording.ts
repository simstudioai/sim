import type { ToolConfig } from '@/tools/types'

interface PostHogGetSessionRecordingParams {
  apiKey: string
  projectId: string
  recordingId: string
  region?: 'us' | 'eu'
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
  start_url?: string
  person?: {
    id: string
    name?: string
    properties?: Record<string, any>
  }
  matching_events?: Array<{
    id: string
    event: string
    timestamp: string
    properties: Record<string, any>
  }>
  snapshot_data_by_window_id?: Record<string, any>
}

interface PostHogGetSessionRecordingResponse {
  success: boolean
  output: {
    recording: PostHogSessionRecording
  }
}

export const getSessionRecordingTool: ToolConfig<
  PostHogGetSessionRecordingParams,
  PostHogGetSessionRecordingResponse
> = {
  id: 'posthog_get_session_recording',
  name: 'PostHog Get Session Recording',
  description: 'Get details of a specific session recording in PostHog by ID.',
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
    recordingId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Session recording ID to retrieve (e.g., "01234567-89ab-cdef-0123-456789abcdef")',
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'PostHog cloud region: us or eu (default: us)',
      default: 'us',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.region === 'eu' ? 'https://eu.posthog.com' : 'https://us.posthog.com'
      return `${baseUrl}/api/projects/${params.projectId}/session_recordings/${params.recordingId}/`
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
        recording: data,
      },
    }
  },

  outputs: {
    recording: {
      type: 'object',
      description: 'Session recording details',
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
        start_url: { type: 'string', description: 'Starting URL of the recording' },
        person: { type: 'object', description: 'Person information' },
        matching_events: { type: 'array', description: 'Events that occurred during recording' },
      },
    },
  },
}
