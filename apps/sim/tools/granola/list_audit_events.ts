import type {
  GranolaListAuditEventsParams,
  GranolaListAuditEventsResponse,
} from '@/tools/granola/types'
import { GRANOLA_API_BASE, granolaHeaders, throwGranolaError } from '@/tools/granola/utils'
import type { ToolConfig } from '@/tools/types'

export const listAuditEventsTool: ToolConfig<
  GranolaListAuditEventsParams,
  GranolaListAuditEventsResponse
> = {
  id: 'granola_list_audit_events',
  name: 'Granola List Audit Events',
  description:
    'Lists workspace audit events from Granola, with optional action and date filters. Events are returned in collection order and retained for one year.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Granola API key',
    },
    action: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Return only events with this exact action, or actions beginning with it followed by a dot (e.g., "workspace" matches workspace.member_added). Lowercase.',
    },
    occurredAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Return events that occurred after this date (ISO 8601). Must fall within the one-year retention window.',
    },
    occurredBefore: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Return events that occurred before this date (ISO 8601). Must fall within the one-year retention window.',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from a previous response',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of audit events per page (1-30, default 10)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`${GRANOLA_API_BASE}/audit`)
      if (params.action) url.searchParams.append('action', params.action.trim())
      if (params.occurredAfter) url.searchParams.append('occurred_after', params.occurredAfter)
      if (params.occurredBefore) url.searchParams.append('occurred_before', params.occurredBefore)
      if (params.cursor) url.searchParams.append('cursor', params.cursor)
      if (params.pageSize) url.searchParams.append('page_size', String(params.pageSize))
      return url.toString()
    },
    method: 'GET',
    headers: (params) => granolaHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) await throwGranolaError(response)

    const data = await response.json()

    return {
      success: true,
      output: {
        events: (data.events ?? []).map(
          (event: {
            id?: string
            action?: string
            occurred_at?: string
            collected_at?: string
            actor?: { object?: string; id?: string | null; email?: string | null }
            data?: Record<string, unknown>
            context?: {
              ip_address?: string | null
              user_agent?: string | null
              client_version?: string | null
            }
          }) => ({
            id: event.id ?? '',
            action: event.action ?? '',
            occurredAt: event.occurred_at ?? '',
            collectedAt: event.collected_at ?? '',
            actorType: event.actor?.object ?? '',
            actorId: event.actor?.id ?? null,
            actorEmail: event.actor?.email ?? null,
            data: event.data ?? {},
            ipAddress: event.context?.ip_address ?? null,
            userAgent: event.context?.user_agent ?? null,
            clientVersion: event.context?.client_version ?? null,
          })
        ),
        hasMore: data.hasMore ?? false,
        cursor: data.cursor ?? null,
      },
    }
  },

  outputs: {
    events: {
      type: 'array',
      description: 'List of audit events',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Audit event ID' },
          action: {
            type: 'string',
            description:
              'The recorded action (e.g., workspace.member_added). Treat as an open set — actions are added over time.',
          },
          occurredAt: { type: 'string', description: 'When the action happened' },
          collectedAt: {
            type: 'string',
            description:
              'When Granola recorded the event. Events are returned in this order, so page on it rather than on occurredAt.',
          },
          actorType: {
            type: 'string',
            description: 'Who performed the action: user, api_key, system, or anonymous',
          },
          actorId: {
            type: 'string',
            description: 'User ID of the actor, when the actor is a resolvable user',
            optional: true,
          },
          actorEmail: {
            type: 'string',
            description: 'Email of the acting user, when the account still exists',
            optional: true,
          },
          data: {
            type: 'json',
            description:
              'Action-specific details. Field names are the ones Granola records internally, so they are camelCase.',
          },
          ipAddress: {
            type: 'string',
            description: 'IP address the request came from, when recorded',
            optional: true,
          },
          userAgent: {
            type: 'string',
            description: 'User agent of the client that made the request, when recorded',
            optional: true,
          },
          clientVersion: {
            type: 'string',
            description: 'Granola client version that made the request, when recorded',
            optional: true,
          },
        },
      },
    },
    hasMore: {
      type: 'boolean',
      description:
        'Whether more audit events are available. A page can hold fewer than pageSize events and still not be the last one.',
    },
    cursor: {
      type: 'string',
      description: 'Pagination cursor for the next page',
      optional: true,
    },
  },
}
