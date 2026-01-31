import type { SentryListEventsParams, SentryListEventsResponse } from '@/tools/sentry/types'
import type { ToolConfig } from '@/tools/types'

export const listEventsTool: ToolConfig<SentryListEventsParams, SentryListEventsResponse> = {
  id: 'sentry_events_list',
  name: 'List Events',
  description:
    'List events from a Sentry project. Can be filtered by issue ID, query, or time period. Returns event details including context, tags, and user information.',
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
    projectSlug: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The slug of the project to list events from (e.g., "my-project")',
    },
    issueId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter events by a specific issue ID (e.g., "12345")',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Search query to filter events. Supports Sentry search syntax (e.g., "user.email:*@example.com")',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor for retrieving next page of results',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of events to return per page (default: 50, max: 100)',
    },
    statsPeriod: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Time period to query (e.g., "24h", "7d", "30d"). Defaults to 90d if not specified.',
    },
  },

  request: {
    url: (params) => {
      let baseUrl: string

      if (params.issueId && params.issueId !== null && params.issueId !== '') {
        // List events for a specific issue
        baseUrl = `https://sentry.io/api/0/organizations/${params.organizationSlug}/issues/${params.issueId}/events/`
      } else {
        // List events for a project
        baseUrl = `https://sentry.io/api/0/projects/${params.organizationSlug}/${params.projectSlug}/events/`
      }

      const queryParams: string[] = []

      if (params.query && params.query !== null && params.query !== '') {
        queryParams.push(`query=${encodeURIComponent(params.query)}`)
      }

      if (params.cursor && params.cursor !== null && params.cursor !== '') {
        queryParams.push(`cursor=${encodeURIComponent(params.cursor)}`)
      }

      if (params.limit && params.limit !== null) {
        queryParams.push(`limit=${Number(params.limit)}`)
      }

      if (params.statsPeriod && params.statsPeriod !== null && params.statsPeriod !== '') {
        queryParams.push(`statsPeriod=${encodeURIComponent(params.statsPeriod)}`)
      }

      return queryParams.length > 0 ? `${baseUrl}?${queryParams.join('&')}` : baseUrl
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    // Extract pagination info from Link header
    const linkHeader = response.headers.get('Link')
    let nextCursor: string | undefined
    let hasMore = false

    if (linkHeader) {
      const nextMatch = linkHeader.match(
        /<[^>]*cursor=([^&>]+)[^>]*>;\s*rel="next";\s*results="true"/
      )
      if (nextMatch) {
        nextCursor = decodeURIComponent(nextMatch[1])
        hasMore = true
      }
    }

    return {
      success: true,
      output: {
        events: data.map((event: any) => ({
          id: event.id,
          eventID: event.eventID,
          projectID: event.projectID,
          groupID: event.groupID,
          message: event.message || '',
          title: event.title,
          location: event.location ?? null,
          culprit: event.culprit ?? null,
          dateCreated: event.dateCreated,
          dateReceived: event.dateReceived,
          user: event.user
            ? {
                id: event.user.id,
                email: event.user.email,
                username: event.user.username,
                ipAddress: event.user.ip_address,
                name: event.user.name,
              }
            : null,
          tags:
            event.tags?.map((tag: any) => ({
              key: tag.key,
              value: tag.value,
            })) || [],
          contexts: event.contexts || {},
          platform: event.platform ?? null,
          type: event.type ?? null,
          metadata: {
            type: event.metadata?.type || null,
            value: event.metadata?.value || null,
            function: event.metadata?.function || null,
          },
          entries: event.entries || [],
          errors: event.errors || [],
          dist: event.dist ?? null,
          fingerprints: event.fingerprints || [],
          sdk: event.sdk
            ? {
                name: event.sdk.name,
                version: event.sdk.version,
              }
            : null,
        })),
        metadata: {
          nextCursor,
          hasMore,
        },
      },
    }
  },

  outputs: {
    events: {
      type: 'array',
      description: 'List of Sentry events',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique event ID' },
          eventID: { type: 'string', description: 'Event identifier' },
          projectID: { type: 'string', description: 'Project ID' },
          groupID: { type: 'string', description: 'Issue group ID' },
          message: { type: 'string', description: 'Event message' },
          title: { type: 'string', description: 'Event title' },
          location: { type: 'string', description: 'Location information', optional: true },
          culprit: {
            type: 'string',
            description: 'Function or location that caused the event',
            optional: true,
          },
          dateCreated: {
            type: 'string',
            description: 'When the event was created (ISO timestamp)',
          },
          dateReceived: {
            type: 'string',
            description: 'When Sentry received the event (ISO timestamp)',
          },
          user: {
            type: 'object',
            description: 'User information associated with the event',
            properties: {
              id: { type: 'string', description: 'User ID' },
              email: { type: 'string', description: 'User email' },
              username: { type: 'string', description: 'Username' },
              ipAddress: { type: 'string', description: 'IP address' },
              name: { type: 'string', description: 'User display name' },
            },
          },
          tags: {
            type: 'array',
            description: 'Tags associated with the event',
            items: {
              type: 'object',
              properties: {
                key: { type: 'string', description: 'Tag key' },
                value: { type: 'string', description: 'Tag value' },
              },
            },
          },
          contexts: { type: 'object', description: 'Additional context data (device, OS, etc.)' },
          platform: {
            type: 'string',
            description: 'Platform where the event occurred',
            optional: true,
          },
          type: { type: 'string', description: 'Event type', optional: true },
          metadata: {
            type: 'object',
            description: 'Error metadata',
            properties: {
              type: { type: 'string', description: 'Type of error (e.g., TypeError)' },
              value: { type: 'string', description: 'Error message or value' },
              function: { type: 'string', description: 'Function where the error occurred' },
            },
          },
          entries: { type: 'array', description: 'Event entries (exception, breadcrumbs, etc.)' },
          errors: { type: 'array', description: 'Processing errors' },
          dist: { type: 'string', description: 'Distribution identifier', optional: true },
          fingerprints: { type: 'array', description: 'Fingerprints for grouping' },
          sdk: {
            type: 'object',
            description: 'SDK information',
            properties: {
              name: { type: 'string', description: 'SDK name' },
              version: { type: 'string', description: 'SDK version' },
            },
          },
        },
      },
    },
    metadata: {
      type: 'object',
      description: 'Pagination metadata',
      properties: {
        nextCursor: {
          type: 'string',
          description: 'Cursor for the next page of results (if available)',
        },
        hasMore: {
          type: 'boolean',
          description: 'Whether there are more results available',
        },
      },
    },
  },
}
