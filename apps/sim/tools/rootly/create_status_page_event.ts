import type {
  RootlyCreateStatusPageEventParams,
  RootlyCreateStatusPageEventResponse,
} from '@/tools/rootly/types'
import type { ToolConfig } from '@/tools/types'

export const rootlyCreateStatusPageEventTool: ToolConfig<
  RootlyCreateStatusPageEventParams,
  RootlyCreateStatusPageEventResponse
> = {
  id: 'rootly_create_status_page_event',
  name: 'Rootly Create Status Page Event',
  description: 'Post a public status page update for a Rootly incident.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rootly API key',
    },
    incidentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the incident',
    },
    event: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The status page update message to publish',
    },
    statusPageId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The ID of the status page to post to',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Status to set (investigating, identified, monitoring, resolved, scheduled, in_progress, completed)',
    },
    notifySubscribers: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to notify status page subscribers',
    },
    shouldTweet: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to post the update to the linked Twitter/X account',
    },
  },

  request: {
    url: (params) =>
      `https://api.rootly.com/v1/incidents/${params.incidentId.trim()}/status-page-events`,
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/vnd.api+json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const attributes: Record<string, unknown> = {
        event: params.event,
      }
      if (params.statusPageId) attributes.status_page_id = params.statusPageId.trim()
      if (params.status) attributes.status = params.status
      if (params.notifySubscribers !== undefined)
        attributes.notify_subscribers = params.notifySubscribers
      if (params.shouldTweet !== undefined) attributes.should_tweet = params.shouldTweet
      return { data: { type: 'incident_status_page_events', attributes } }
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return {
        success: false,
        output: {
          statusPageEvent: {} as RootlyCreateStatusPageEventResponse['output']['statusPageEvent'],
        },
        error: errorData.errors?.[0]?.detail || `HTTP ${response.status}: ${response.statusText}`,
      }
    }

    const data = await response.json()
    const attrs = data.data?.attributes || {}
    return {
      success: true,
      output: {
        statusPageEvent: {
          id: data.data?.id ?? null,
          event: attrs.event ?? '',
          statusPageId: attrs.status_page_id ?? null,
          status: attrs.status ?? null,
          notifySubscribers: attrs.notify_subscribers ?? null,
          shouldTweet: attrs.should_tweet ?? null,
          startedAt: attrs.started_at ?? null,
          createdAt: attrs.created_at ?? '',
          updatedAt: attrs.updated_at ?? '',
        },
      },
    }
  },

  outputs: {
    statusPageEvent: {
      type: 'object',
      description: 'The created status page event',
      properties: {
        id: { type: 'string', description: 'Unique status page event ID' },
        event: { type: 'string', description: 'The published update message' },
        statusPageId: { type: 'string', description: 'Status page ID' },
        status: { type: 'string', description: 'Status that was set' },
        notifySubscribers: { type: 'boolean', description: 'Whether subscribers were notified' },
        shouldTweet: { type: 'boolean', description: 'Whether the update was tweeted' },
        startedAt: { type: 'string', description: 'When the event started' },
        createdAt: { type: 'string', description: 'Creation date' },
        updatedAt: { type: 'string', description: 'Last update date' },
      },
    },
  },
}
