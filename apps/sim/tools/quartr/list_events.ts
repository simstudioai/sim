import {
  QUARTR_EVENT_OUTPUT_PROPERTIES,
  type QuartrEventDto,
  type QuartrListEventsParams,
  type QuartrListEventsResponse,
  type QuartrPaginatedDto,
} from '@/tools/quartr/types'
import {
  buildQuartrListQuery,
  buildQuartrUrl,
  mapQuartrEvent,
  normalizeQuartrCommaList,
  parseQuartrResponse,
} from '@/tools/quartr/utils'
import type { ToolConfig } from '@/tools/types'

export const quartrListEventsTool: ToolConfig<QuartrListEventsParams, QuartrListEventsResponse> = {
  id: 'quartr_list_events',
  name: 'Quartr List Events',
  description:
    'List corporate events (earnings calls, capital markets days, etc.) from Quartr, filterable by company, event type, and date range.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Quartr API key',
    },
    companyIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of Quartr company IDs (e.g., "4742,128")',
    },
    tickers: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of company tickers (e.g., "AAPL,MSFT")',
    },
    isins: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of ISINs (e.g., "US0378331005")',
    },
    ciks: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of SEC CIKs (e.g., "0000320193")',
    },
    countries: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of ISO 3166-1 alpha-2 country codes (e.g., "US,SE")',
    },
    exchanges: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of exchange symbols, without whitespace (e.g., "NasdaqGS")',
    },
    eventTypeIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of event type IDs (e.g., "26,27")',
    },
    startDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return events on or after this ISO 8601 date (e.g., "2024-01-01")',
    },
    endDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return events on or before this ISO 8601 date (e.g., "2024-12-31")',
    },
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Field to sort by: "id" or "date" (default: id)',
    },
    updatedAfter: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Only return data updated after this ISO 8601 date (e.g., "2024-01-01")',
    },
    updatedBefore: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Only return data updated before this ISO 8601 date (e.g., "2024-12-31")',
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
      description: 'Sort direction applied to the sortBy field: "asc" or "desc" (default: asc)',
    },
  },

  request: {
    url: (params) =>
      buildQuartrUrl('/events', {
        ...buildQuartrListQuery(params),
        companyIds: normalizeQuartrCommaList(params.companyIds),
        typeIds: normalizeQuartrCommaList(params.eventTypeIds),
        startDate: params.startDate,
        endDate: params.endDate,
        sortBy: params.sortBy,
      }),
    method: 'GET',
    headers: (params) => ({ 'x-api-key': params.apiKey }),
  },

  transformResponse: async (response) => {
    const data = await parseQuartrResponse<QuartrPaginatedDto<QuartrEventDto>>(
      response,
      'list events'
    )

    return {
      success: true,
      output: {
        events: (data.data ?? []).map(mapQuartrEvent),
        nextCursor: data.pagination?.nextCursor ?? null,
      },
    }
  },

  outputs: {
    events: {
      type: 'array',
      description: 'Events matching the filters',
      items: { type: 'object', properties: QUARTR_EVENT_OUTPUT_PROPERTIES },
    },
    nextCursor: {
      type: 'number',
      description: 'Cursor for fetching the next page of results (null when no more pages)',
      optional: true,
    },
  },
}
