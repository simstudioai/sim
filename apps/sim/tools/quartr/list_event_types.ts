import {
  QUARTR_EVENT_TYPE_OUTPUT_PROPERTIES,
  type QuartrEventTypeDto,
  type QuartrListEventTypesParams,
  type QuartrListEventTypesResponse,
  type QuartrPaginatedDto,
} from '@/tools/quartr/types'
import { buildQuartrUrl, mapQuartrEventType, parseQuartrResponse } from '@/tools/quartr/utils'
import type { ToolConfig } from '@/tools/types'

export const quartrListEventTypesTool: ToolConfig<
  QuartrListEventTypesParams,
  QuartrListEventTypesResponse
> = {
  id: 'quartr_list_event_types',
  name: 'Quartr List Event Types',
  description:
    'List the event types available in Quartr (e.g., earnings calls), useful for filtering events by type ID.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Quartr API key',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of items to return in a single request (default: 10, max: 500)',
    },
    cursor: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from the previous response (nextCursor) for the next page',
    },
    direction: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Sort direction by id: "asc" or "desc" (default: asc)',
    },
  },

  request: {
    url: (params) =>
      buildQuartrUrl('/event-types', {
        limit: params.limit,
        cursor: params.cursor,
        direction: params.direction,
      }),
    method: 'GET',
    headers: (params) => ({ 'x-api-key': params.apiKey }),
  },

  transformResponse: async (response) => {
    const data = await parseQuartrResponse<QuartrPaginatedDto<QuartrEventTypeDto>>(
      response,
      'list event types'
    )

    return {
      success: true,
      output: {
        eventTypes: (data.data ?? []).map(mapQuartrEventType),
        nextCursor: data.pagination?.nextCursor ?? null,
      },
    }
  },

  outputs: {
    eventTypes: {
      type: 'array',
      description: 'Available event types',
      items: { type: 'object', properties: QUARTR_EVENT_TYPE_OUTPUT_PROPERTIES },
    },
    nextCursor: {
      type: 'number',
      description: 'Cursor for fetching the next page of results (null when no more pages)',
      optional: true,
    },
  },
}
