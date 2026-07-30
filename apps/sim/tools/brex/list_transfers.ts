import type { BrexListTransfersResponse, BrexPaginationParams } from '@/tools/brex/types'
import { BREX_MONEY_PROPERTIES } from '@/tools/brex/types'
import {
  appendBrexPagination,
  BREX_API_BASE,
  buildBrexHeaders,
  parseBrexJson,
} from '@/tools/brex/utils'
import type { ToolConfig } from '@/tools/types'

export const brexListTransfersTool: ToolConfig<BrexPaginationParams, BrexListTransfersResponse> = {
  id: 'brex_list_transfers',
  name: 'Brex List Transfers',
  description: 'List money transfers in the Brex account',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Brex user token (generated from Developer Settings in the Brex dashboard)',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from a previous response',
    },
    limit: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of transfers to return (default 100, max 1000)',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      appendBrexPagination(query, params)
      const queryString = query.toString()
      return queryString
        ? `${BREX_API_BASE}/v1/transfers?${queryString}`
        : `${BREX_API_BASE}/v1/transfers`
    },
    method: 'GET',
    headers: (params) => buildBrexHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await parseBrexJson(response)
    return {
      success: true,
      output: {
        items: data.items ?? [],
        nextCursor: data.next_cursor ?? null,
      },
    }
  },

  outputs: {
    items: {
      type: 'array',
      description: 'Transfers in the Brex account',
      items: {
        type: 'json',
        properties: {
          id: { type: 'string', description: 'Unique transfer ID' },
          counterparty: {
            type: 'json',
            description: 'Transfer counterparty details',
            optional: true,
          },
          description: { type: 'string', description: 'Transfer description', optional: true },
          payment_type: {
            type: 'string',
            description:
              'Payment type (ACH, DOMESTIC_WIRE, CHEQUE, INTERNATIONAL_WIRE, BOOK_TRANSFER, STABLECOIN)',
          },
          amount: {
            type: 'json',
            description: 'Transfer amount',
            properties: BREX_MONEY_PROPERTIES,
          },
          process_date: {
            type: 'string',
            description: 'Date the transfer processes',
            optional: true,
          },
          originating_account: {
            type: 'json',
            description: 'Account the transfer originates from',
          },
          status: {
            type: 'string',
            description:
              'Transfer status (PROCESSING, SCHEDULED, PENDING_APPROVAL, FAILED, PROCESSED)',
          },
          cancellation_reason: {
            type: 'string',
            description: 'Reason the transfer was canceled',
            optional: true,
          },
          estimated_delivery_date: {
            type: 'string',
            description: 'Estimated delivery date',
            optional: true,
          },
          creator_user_id: {
            type: 'string',
            description: 'ID of the user who created the transfer',
            optional: true,
          },
          created_at: { type: 'string', description: 'Creation timestamp', optional: true },
          display_name: { type: 'string', description: 'Transfer display name', optional: true },
          external_memo: { type: 'string', description: 'External memo', optional: true },
          is_ppro_enabled: {
            type: 'boolean',
            description: 'Whether Principal Protection (PPRO) is enabled',
            optional: true,
          },
        },
      },
    },
    nextCursor: {
      type: 'string',
      description: 'Cursor for fetching the next page of results',
      optional: true,
    },
  },
}
