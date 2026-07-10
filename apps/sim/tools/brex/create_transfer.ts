import { generateId } from '@sim/utils/id'
import type { BrexCreateTransferParams, BrexCreateTransferResponse } from '@/tools/brex/types'
import { BREX_MONEY_PROPERTIES } from '@/tools/brex/types'
import { BREX_API_BASE, buildBrexHeaders, parseBrexJson } from '@/tools/brex/utils'
import type { ToolConfig } from '@/tools/types'

export const brexCreateTransferTool: ToolConfig<
  BrexCreateTransferParams,
  BrexCreateTransferResponse
> = {
  id: 'brex_create_transfer',
  name: 'Brex Create Transfer',
  description: 'Create a money transfer from a Brex cash account to a vendor',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Brex user token (generated from Developer Settings in the Brex dashboard)',
    },
    cashAccountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'ID of the Brex cash account to send the transfer from (found via the /accounts endpoint)',
    },
    vendorPaymentInstrumentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        "ID of the vendor's payment instrument to send the transfer to (from the vendor's payment_accounts)",
    },
    amount: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Amount to transfer, in the smallest unit of the currency (e.g., cents for USD)',
    },
    currency: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO 4217 currency code (defaults to USD)',
    },
    description: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Description of the transfer for internal use (not exposed externally)',
    },
    externalMemo: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'External memo shown to the recipient (max 90 characters for ACH/Wire, 40 for Cheque)',
    },
    approvalType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set to MANUAL to require cash admin approval before the transfer is sent',
    },
    isPproEnabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Enable Principal Protection (PPRO) to have Brex cover intermediary/receiving bank fees (international wires only)',
    },
  },

  request: {
    url: () => `${BREX_API_BASE}/v1/transfers`,
    method: 'POST',
    headers: (params) => ({
      ...buildBrexHeaders(params.apiKey),
      // Brex requires a fresh Idempotency-Key per transfer creation to prevent duplicate money movement.
      'Idempotency-Key': generateId(),
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        counterparty: {
          type: 'VENDOR',
          payment_instrument_id: params.vendorPaymentInstrumentId,
        },
        amount: {
          amount: params.amount,
          currency: params.currency || 'USD',
        },
        description: params.description,
        external_memo: params.externalMemo,
        originating_account: {
          type: 'BREX_CASH',
          id: params.cashAccountId,
        },
      }
      if (params.approvalType) body.approval_type = params.approvalType
      if (params.isPproEnabled !== undefined) body.is_ppro_enabled = params.isPproEnabled
      return body
    },
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
    description: { type: 'string', description: 'Description of the transfer', optional: true },
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
    processDate: { type: 'string', description: 'Transaction processing date', optional: true },
    originatingAccount: {
      type: 'json',
      description: 'Originating account details for the transfer',
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
      description: 'Estimated delivery date for the transfer',
      optional: true,
    },
    creatorUserId: {
      type: 'string',
      description: 'ID of the user who created the transfer',
      optional: true,
    },
    createdAt: {
      type: 'string',
      description: 'Creation timestamp of the transfer',
      optional: true,
    },
    displayName: {
      type: 'string',
      description: 'Human-readable name of the transfer',
      optional: true,
    },
    externalMemo: { type: 'string', description: 'External memo of the transfer', optional: true },
    isPproEnabled: {
      type: 'boolean',
      description: 'Whether Principal Protection (PPRO) is enabled for the transfer',
      optional: true,
    },
  },
}
