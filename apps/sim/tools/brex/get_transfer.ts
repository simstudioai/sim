import type { BrexGetTransferParams, BrexGetTransferResponse } from '@/tools/brex/types'
import { BREX_MONEY_PROPERTIES } from '@/tools/brex/types'
import { BREX_API_BASE, buildBrexHeaders, parseBrexJson } from '@/tools/brex/utils'
import type { ToolConfig } from '@/tools/types'

export const brexGetTransferTool: ToolConfig<BrexGetTransferParams, BrexGetTransferResponse> = {
  id: 'brex_get_transfer',
  name: 'Brex Get Transfer',
  description: 'Get a Brex money transfer by its ID',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Brex user token (generated from Developer Settings in the Brex dashboard)',
    },
    transferId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the transfer to fetch',
    },
  },

  request: {
    url: (params) =>
      `${BREX_API_BASE}/v1/transfers/${encodeURIComponent(params.transferId.trim())}`,
    method: 'GET',
    headers: (params) => buildBrexHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await parseBrexJson(response)
    return {
      success: true,
      output: {
        id: data.id ?? '',
        counterparty: data.counterparty ?? null,
        description: data.description ?? null,
        paymentType: data.payment_type ?? '',
        amount: data.amount ?? null,
        processDate: data.process_date ?? null,
        originatingAccount: data.originating_account ?? null,
        status: data.status ?? '',
        cancellationReason: data.cancellation_reason ?? null,
        estimatedDeliveryDate: data.estimated_delivery_date ?? null,
        creatorUserId: data.creator_user_id ?? null,
        createdAt: data.created_at ?? null,
        displayName: data.display_name ?? null,
        externalMemo: data.external_memo ?? null,
        isPproEnabled: data.is_ppro_enabled ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Unique transfer ID' },
    counterparty: { type: 'json', description: 'Transfer counterparty details', optional: true },
    description: { type: 'string', description: 'Transfer description', optional: true },
    paymentType: {
      type: 'string',
      description:
        'Payment type (ACH, DOMESTIC_WIRE, CHEQUE, INTERNATIONAL_WIRE, BOOK_TRANSFER, STABLECOIN)',
    },
    amount: {
      type: 'json',
      description: 'Transfer amount',
      optional: true,
      properties: BREX_MONEY_PROPERTIES,
    },
    processDate: { type: 'string', description: 'Date the transfer processes', optional: true },
    originatingAccount: {
      type: 'json',
      description: 'Account the transfer originates from',
      optional: true,
    },
    status: {
      type: 'string',
      description: 'Transfer status (PROCESSING, SCHEDULED, PENDING_APPROVAL, FAILED, PROCESSED)',
    },
    cancellationReason: {
      type: 'string',
      description: 'Reason the transfer was canceled',
      optional: true,
    },
    estimatedDeliveryDate: {
      type: 'string',
      description: 'Estimated delivery date',
      optional: true,
    },
    creatorUserId: {
      type: 'string',
      description: 'ID of the user who created the transfer',
      optional: true,
    },
    createdAt: { type: 'string', description: 'Creation timestamp', optional: true },
    displayName: { type: 'string', description: 'Transfer display name', optional: true },
    externalMemo: { type: 'string', description: 'External memo', optional: true },
    isPproEnabled: {
      type: 'boolean',
      description: 'Whether Principal Protection (PPRO) is enabled',
      optional: true,
    },
  },
}
