import type { LumaGetGuestsParams, LumaGetGuestsResponse } from '@/tools/luma/types'
import { LUMA_GUEST_OUTPUT_PROPERTIES } from '@/tools/luma/types'
import type { ToolConfig } from '@/tools/types'

export const getGuestsTool: ToolConfig<LumaGetGuestsParams, LumaGetGuestsResponse> = {
  id: 'luma_get_guests',
  name: 'Luma Get Guests',
  description:
    'Retrieve the guest list for a Luma event with optional filtering by approval status, sorting, and pagination.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Luma API key',
    },
    eventId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Event ID (starts with evt-)',
    },
    approvalStatus: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter by approval status: approved, session, pending_approval, invited, declined, or waitlist',
    },
    paginationLimit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of guests to return per page',
    },
    paginationCursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Pagination cursor from a previous response (next_cursor) to fetch the next page of results',
    },
    sortColumn: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Column to sort by: name, email, created_at, registered_at, or checked_in_at',
    },
    sortDirection: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort direction: asc, desc, asc nulls last, or desc nulls last',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://public-api.luma.com/v1/event/get-guests')
      url.searchParams.set('event_id', params.eventId)
      if (params.approvalStatus) url.searchParams.set('approval_status', params.approvalStatus)
      if (params.paginationLimit)
        url.searchParams.set('pagination_limit', String(params.paginationLimit))
      if (params.paginationCursor)
        url.searchParams.set('pagination_cursor', params.paginationCursor)
      if (params.sortColumn) url.searchParams.set('sort_column', params.sortColumn)
      if (params.sortDirection) url.searchParams.set('sort_direction', params.sortDirection)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      'x-luma-api-key': params.apiKey,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Failed to get guests')
    }

    const guests = (data.entries ?? []).map((entry: Record<string, unknown>) => {
      const guest = entry.guest as Record<string, unknown>
      return {
        id: (guest.id as string) ?? null,
        email: (guest.user_email as string) ?? null,
        name: (guest.user_name as string) ?? null,
        firstName: (guest.user_first_name as string) ?? null,
        lastName: (guest.user_last_name as string) ?? null,
        approvalStatus: (guest.approval_status as string) ?? null,
        registeredAt: (guest.registered_at as string) ?? null,
        invitedAt: (guest.invited_at as string) ?? null,
        joinedAt: (guest.joined_at as string) ?? null,
        checkedInAt: (guest.checked_in_at as string) ?? null,
        phoneNumber: (guest.phone_number as string) ?? null,
      }
    })

    return {
      success: true,
      output: {
        guests,
        hasMore: data.has_more ?? false,
        nextCursor: data.next_cursor ?? null,
      },
    }
  },

  outputs: {
    guests: {
      type: 'array',
      description: 'List of event guests',
      items: {
        type: 'object',
        properties: LUMA_GUEST_OUTPUT_PROPERTIES,
      },
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether more results are available for pagination',
    },
    nextCursor: {
      type: 'string',
      description: 'Cursor to pass as paginationCursor to fetch the next page',
      optional: true,
    },
  },
}
