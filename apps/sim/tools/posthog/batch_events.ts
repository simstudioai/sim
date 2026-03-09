import type { ToolConfig } from '@/tools/types'

export interface PostHogBatchEventsParams {
  projectApiKey: string
  region?: 'us' | 'eu'
  batch: string
}

export interface PostHogBatchEventsResponse {
  success: boolean
  output: {
    status: string
    events_processed: number
  }
}

export const batchEventsTool: ToolConfig<PostHogBatchEventsParams, PostHogBatchEventsResponse> = {
  id: 'posthog_batch_events',
  name: 'PostHog Batch Events',
  description:
    'Capture multiple events at once in PostHog. Use this for bulk event ingestion to improve performance.',
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
    batch: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON array of events to capture. Each event should have: event, distinct_id, and optional properties, timestamp. Example: [{"event": "page_view", "distinct_id": "user123", "properties": {"page": "/"}}]',
    },
  },

  request: {
    url: (params) => {
      const baseUrl =
        params.region === 'eu' ? 'https://eu.i.posthog.com' : 'https://us.i.posthog.com'
      return `${baseUrl}/batch/`
    },
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      let batch: any[]
      try {
        batch = JSON.parse(params.batch)
      } catch (e) {
        batch = []
      }

      return {
        api_key: params.projectApiKey,
        batch: batch,
      }
    },
  },

  transformResponse: async (response: Response) => {
    if (response.ok) {
      const data = await response.json()
      return {
        success: true,
        output: {
          status: 'Batch events captured successfully',
          events_processed: data.status === 1 ? JSON.parse(data.batch || '[]').length : 0,
        },
      }
    }

    const error = await response.text()
    return {
      success: false,
      output: {
        status: 'Failed to capture batch events',
        events_processed: 0,
      },
      error: error || 'Unknown error occurred',
    }
  },

  outputs: {
    status: {
      type: 'string',
      description: 'Status message indicating whether the batch was captured successfully',
    },
    events_processed: {
      type: 'number',
      description: 'Number of events processed in the batch',
    },
  },
}
