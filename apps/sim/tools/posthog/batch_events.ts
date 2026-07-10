import { getErrorMessage } from '@sim/utils/errors'
import { getPostHogIngestBaseUrl } from '@/tools/posthog/utils'
import type { ToolConfig } from '@/tools/types'

export interface PostHogBatchEventsParams {
  projectApiKey: string
  region?: 'us' | 'eu'
  host?: string
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
    host: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Self-hosted PostHog instance host (e.g., "posthog.mycompany.com"). Overrides the region setting when provided.',
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
      const baseUrl = getPostHogIngestBaseUrl(params.region, params.host)
      return `${baseUrl}/batch/`
    },
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      let batch: unknown
      try {
        batch = JSON.parse(params.batch)
      } catch (error) {
        throw new Error(`Invalid batch JSON: ${getErrorMessage(error)}`)
      }
      if (!Array.isArray(batch)) {
        throw new Error('batch must be a JSON array of events')
      }

      return {
        api_key: params.projectApiKey,
        batch,
      }
    },
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json()
    const eventsProcessed = params ? (JSON.parse(params.batch) as unknown[]).length : 0
    const success = data.status === 1

    return {
      success,
      output: {
        status: success
          ? 'Batch events captured successfully'
          : `Batch events capture failed (status: ${data.status})`,
        events_processed: success ? eventsProcessed : 0,
      },
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
