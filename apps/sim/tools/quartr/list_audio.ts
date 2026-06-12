import {
  QUARTR_AUDIO_OUTPUT_PROPERTIES,
  type QuartrAudioDto,
  type QuartrListAudioParams,
  type QuartrListAudioResponse,
  type QuartrPaginatedDto,
} from '@/tools/quartr/types'
import {
  buildQuartrListQuery,
  buildQuartrUrl,
  isQuartrToggleEnabled,
  mapQuartrAudio,
  normalizeQuartrCommaList,
  parseQuartrResponse,
} from '@/tools/quartr/utils'
import type { ToolConfig } from '@/tools/types'

export const quartrListAudioTool: ToolConfig<QuartrListAudioParams, QuartrListAudioResponse> = {
  id: 'quartr_list_audio',
  name: 'Quartr List Audio',
  description:
    'List archived event audio recordings from Quartr, filterable by company, event, and date range. Returns download (MPEG) and streaming (M3U8) URLs.',
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
    startDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return audio dated on or after this ISO 8601 date (e.g., "2024-01-01")',
    },
    endDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return audio dated on or before this ISO 8601 date (e.g., "2024-12-31")',
    },
    expandEvent: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include expanded event details on each audio recording',
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
      buildQuartrUrl('/audio', {
        ...buildQuartrListQuery(params),
        companyIds: normalizeQuartrCommaList(params.companyIds),
        eventIds: normalizeQuartrCommaList(params.eventIds),
        startDate: params.startDate,
        endDate: params.endDate,
        expand: isQuartrToggleEnabled(params.expandEvent) ? 'event' : undefined,
      }),
    method: 'GET',
    headers: (params) => ({ 'x-api-key': params.apiKey }),
  },

  transformResponse: async (response) => {
    const data = await parseQuartrResponse<QuartrPaginatedDto<QuartrAudioDto>>(
      response,
      'list audio'
    )

    return {
      success: true,
      output: {
        audioRecordings: (data.data ?? []).map(mapQuartrAudio),
        nextCursor: data.pagination?.nextCursor ?? null,
      },
    }
  },

  outputs: {
    audioRecordings: {
      type: 'array',
      description: 'Audio recordings matching the filters',
      items: { type: 'object', properties: QUARTR_AUDIO_OUTPUT_PROPERTIES },
    },
    nextCursor: {
      type: 'number',
      description: 'Cursor for fetching the next page of results (null when no more pages)',
      optional: true,
    },
  },
}
