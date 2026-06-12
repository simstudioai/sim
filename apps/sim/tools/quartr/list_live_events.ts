import {
  QUARTR_LIVE_EVENT_OUTPUT_PROPERTIES,
  type QuartrListLiveEventsParams,
  type QuartrListLiveEventsResponse,
  type QuartrLiveEventDto,
  type QuartrPaginatedDto,
} from '@/tools/quartr/types'
import {
  buildQuartrListQuery,
  buildQuartrUrl,
  mapQuartrLiveEvent,
  normalizeQuartrCommaList,
  parseQuartrResponse,
} from '@/tools/quartr/utils'
import type { ToolConfig } from '@/tools/types'

export const quartrListLiveEventsTool: ToolConfig<
  QuartrListLiveEventsParams,
  QuartrListLiveEventsResponse
> = {
  id: 'quartr_list_live_events',
  name: 'Quartr List Live Events',
  description:
    'List live and upcoming events from Quartr with live audio and transcript stream URLs, filterable by company, live state, and date range.',
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
    eventIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of Quartr event IDs (e.g., "128301")',
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
    states: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of live states to filter by: notLive, willBeLive, live, liveFailedInterrupted, liveFailedNoAccess, liveFailedNotStarted, processingRecording, processingRecordingFailed, recordingAvailable',
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
    transcriptVersion: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Version of the live transcript stream: "1.6" or "1.7" (default: 1.6)',
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
      description: 'Sort direction by id: "asc" or "desc" (default: asc)',
    },
  },

  request: {
    url: (params) =>
      buildQuartrUrl('/live', {
        ...buildQuartrListQuery(params),
        companyIds: normalizeQuartrCommaList(params.companyIds),
        eventIds: normalizeQuartrCommaList(params.eventIds),
        states: normalizeQuartrCommaList(params.states),
        startDate: params.startDate,
        endDate: params.endDate,
        transcriptVersion: params.transcriptVersion,
      }),
    method: 'GET',
    headers: (params) => ({ 'x-api-key': params.apiKey }),
  },

  transformResponse: async (response) => {
    const data = await parseQuartrResponse<QuartrPaginatedDto<QuartrLiveEventDto>>(
      response,
      'list live events'
    )

    return {
      success: true,
      output: {
        liveEvents: (data.data ?? []).map(mapQuartrLiveEvent),
        nextCursor: data.pagination?.nextCursor ?? null,
      },
    }
  },

  outputs: {
    liveEvents: {
      type: 'array',
      description: 'Live events matching the filters',
      items: { type: 'object', properties: QUARTR_LIVE_EVENT_OUTPUT_PROPERTIES },
    },
    nextCursor: {
      type: 'number',
      description: 'Cursor for fetching the next page of results (null when no more pages)',
      optional: true,
    },
  },
}
