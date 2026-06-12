import {
  QUARTR_DOCUMENT_OUTPUT_PROPERTIES,
  type QuartrDocumentDto,
  type QuartrListDocumentsParams,
  type QuartrListSlideDecksResponse,
  type QuartrPaginatedDto,
} from '@/tools/quartr/types'
import {
  buildQuartrDocumentListQuery,
  buildQuartrUrl,
  mapQuartrDocument,
  parseQuartrResponse,
} from '@/tools/quartr/utils'
import type { ToolConfig } from '@/tools/types'

export const quartrListSlideDecksTool: ToolConfig<
  QuartrListDocumentsParams,
  QuartrListSlideDecksResponse
> = {
  id: 'quartr_list_slide_decks',
  name: 'Quartr List Slide Decks',
  description:
    'List slide presentations from Quartr, filterable by company, event, document type, document group, and date range.',
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
    documentTypeIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of document type IDs (e.g., "7,10")',
    },
    documentGroupIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of document group IDs: 1 = Earnings Release, 2 = Press Release, 3 = Interim Report, 4 = Annual Report, 5 = Proxy Statement, 6 = Registration Statement',
    },
    startDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Only return documents dated on or after this ISO 8601 date (e.g., "2024-01-01")',
    },
    endDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Only return documents dated on or before this ISO 8601 date (e.g., "2024-12-31")',
    },
    expandEvent: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include expanded event details on each document',
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
    url: (params) => buildQuartrUrl('/documents/slides', buildQuartrDocumentListQuery(params)),
    method: 'GET',
    headers: (params) => ({ 'x-api-key': params.apiKey }),
  },

  transformResponse: async (response) => {
    const data = await parseQuartrResponse<QuartrPaginatedDto<QuartrDocumentDto>>(
      response,
      'list slide decks'
    )

    return {
      success: true,
      output: {
        slideDecks: (data.data ?? []).map(mapQuartrDocument),
        nextCursor: data.pagination?.nextCursor ?? null,
      },
    }
  },

  outputs: {
    slideDecks: {
      type: 'array',
      description: 'Slide decks matching the filters',
      items: { type: 'object', properties: QUARTR_DOCUMENT_OUTPUT_PROPERTIES },
    },
    nextCursor: {
      type: 'number',
      description: 'Cursor for fetching the next page of results (null when no more pages)',
      optional: true,
    },
  },
}
