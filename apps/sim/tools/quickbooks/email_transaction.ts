import { ErrorExtractorId } from '@/tools/error-extractors'
import {
  buildQuickBooksCompanyUrl,
  buildQuickBooksHeaders,
  QUICKBOOKS_MAX_RESPONSE_BYTES,
} from '@/tools/quickbooks/client'
import {
  getQuickBooksDocumentTransaction,
  validateQuickBooksRecipient,
} from '@/tools/quickbooks/documents_utils'
import type {
  QuickBooksEmailTransactionParams,
  QuickBooksEmailTransactionResponse,
  QuickBooksTransaction,
} from '@/tools/quickbooks/types'
import { QUICKBOOKS_SALES_TRANSACTION_PROPERTIES } from '@/tools/quickbooks/types'
import { parseQuickBooksJson, requiredQuickBooksString } from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

export const quickbooksEmailTransactionTool: ToolConfig<
  QuickBooksEmailTransactionParams,
  QuickBooksEmailTransactionResponse
> = {
  id: 'quickbooks_email_transaction',
  name: 'QuickBooks Email Transaction',
  description:
    'Send a supported QuickBooks transaction by email. This causes an external email and Intuit limits sandbox email delivery.',
  version: '1.0.0',
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'QuickBooks OAuth access token',
    },
    realmId: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'QuickBooks company ID derived from the connected credential',
    },
    transactionType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Supported transaction type to email',
    },
    transactionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'QuickBooks transaction ID',
    },
    recipient: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional single recipient override; otherwise QuickBooks uses the stored recipient',
    },
    confirmSend: {
      type: 'boolean',
      required: true,
      visibility: 'user-only',
      description: 'Explicit confirmation that an external email should be sent',
    },
  },
  oauth: {
    required: true,
    provider: 'quickbooks',
    requiredScopes: ['com.intuit.quickbooks.accounting'],
  },
  errorExtractor: ErrorExtractorId.QUICKBOOKS_FAULT,
  request: {
    url: (params) => {
      if (params.confirmSend !== true)
        throw new Error('Confirm sending before emailing a QuickBooks transaction')
      const { resource } = getQuickBooksDocumentTransaction(params.transactionType)
      const id = requiredQuickBooksString(params.transactionId, 'transactionId')
      const url = buildQuickBooksCompanyUrl(
        params.realmId,
        `${resource}/${encodeURIComponent(id)}/send`
      )
      const recipient = validateQuickBooksRecipient(params.recipient)
      if (recipient) url.searchParams.set('sendTo', recipient)
      return url.toString()
    },
    method: 'POST',
    headers: (params) => ({
      ...buildQuickBooksHeaders(params.accessToken),
      'Content-Type': 'application/octet-stream',
    }),
    retry: { enabled: false },
    maxResponseBytes: QUICKBOOKS_MAX_RESPONSE_BYTES,
  },
  transformResponse: async (response, params) => {
    if (!params) throw new Error('QuickBooks Email Transaction parameters are required')
    const { entity } = getQuickBooksDocumentTransaction(params.transactionType)
    const data = await parseQuickBooksJson<Record<string, unknown> & { time?: string }>(
      response,
      `QuickBooks ${entity} email response`
    )
    const record = data[entity]
    if (record !== undefined && (!record || typeof record !== 'object' || Array.isArray(record))) {
      throw new Error(`QuickBooks ${entity} email response contains a malformed ${entity}`)
    }
    return {
      success: true,
      output: {
        transactionType: params.transactionType,
        transactionId: requiredQuickBooksString(params.transactionId, 'transactionId'),
        sent: true,
        record: record as QuickBooksTransaction | undefined,
        time: typeof data.time === 'string' ? data.time : null,
      },
    }
  },
  outputs: {
    transactionType: { type: 'string', description: 'Emailed QuickBooks transaction type' },
    transactionId: { type: 'string', description: 'Emailed QuickBooks transaction ID' },
    sent: { type: 'boolean', description: 'Whether QuickBooks accepted the email send request' },
    record: {
      type: 'json',
      description: 'Native QuickBooks transaction returned after sending',
      optional: true,
      properties: QUICKBOOKS_SALES_TRANSACTION_PROPERTIES,
    },
    time: {
      type: 'string',
      description: 'QuickBooks response timestamp',
      optional: true,
      nullable: true,
    },
  },
}
