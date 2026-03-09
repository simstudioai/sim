import type { SentryGetEventParams, SentryGetEventResponse } from '@/tools/sentry/types'
import type { ToolConfig } from '@/tools/types'

export const getEventTool: ToolConfig<SentryGetEventParams, SentryGetEventResponse> = {
  id: 'sentry_events_get',
  name: 'Get Event',
  description:
    'Retrieve detailed information about a specific Sentry event by its ID. Returns complete event details including stack traces, breadcrumbs, context, and user information.',
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
      description: 'The slug of the project (e.g., "my-project")',
    },
    eventId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique ID of the event to retrieve (e.g., "abc123def456")',
    },
  },

  request: {
    url: (params) =>
      `https://sentry.io/api/0/projects/${params.organizationSlug}/${params.projectSlug}/events/${params.eventId}/`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const event = await response.json()

    return {
      success: true,
      output: {
        event: {
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
        },
      },
    }
  },

  outputs: {
    event: {
      type: 'object',
      description: 'Detailed information about the Sentry event',
      properties: {
        id: { type: 'string', description: 'Unique event ID' },
        eventID: { type: 'string', description: 'Event identifier' },
        projectID: { type: 'string', description: 'Project ID' },
        groupID: { type: 'string', description: 'Issue group ID this event belongs to' },
        message: { type: 'string', description: 'Event message' },
        title: { type: 'string', description: 'Event title' },
        location: { type: 'string', description: 'Location information', optional: true },
        culprit: {
          type: 'string',
          description: 'Function or location that caused the event',
          optional: true,
        },
        dateCreated: { type: 'string', description: 'When the event was created (ISO timestamp)' },
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
        contexts: {
          type: 'object',
          description: 'Additional context data (device, OS, browser, etc.)',
        },
        platform: {
          type: 'string',
          description: 'Platform where the event occurred',
          optional: true,
        },
        type: {
          type: 'string',
          description: 'Event type (error, transaction, etc.)',
          optional: true,
        },
        metadata: {
          type: 'object',
          description: 'Error metadata',
          properties: {
            type: { type: 'string', description: 'Type of error (e.g., TypeError, ValueError)' },
            value: { type: 'string', description: 'Error message or value' },
            function: { type: 'string', description: 'Function where the error occurred' },
          },
        },
        entries: {
          type: 'array',
          description: 'Event entries including exception, breadcrumbs, and request data',
        },
        errors: {
          type: 'array',
          description: 'Processing errors that occurred',
        },
        dist: { type: 'string', description: 'Distribution identifier', optional: true },
        fingerprints: {
          type: 'array',
          description: 'Fingerprints used for grouping events',
          items: { type: 'string' },
        },
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
}
