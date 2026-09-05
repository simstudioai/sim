import { ErrorExtractorId } from '@/tools/error-extractors'
import { buildQuickBooksCompanyUrl, buildQuickBooksHeaders } from '@/tools/quickbooks/client'
import {
  getQuickBooksDocumentTransaction,
  validateQuickBooksRecipient,
} from '@/tools/quickbooks/documents_utils'
import type {
  QuickBooksEmailTransactionParams,
  QuickBooksEmailTransactionResponse,
  QuickBooksTransaction,
} from '@/tools/quickbooks/types'
import { QUICKBOOKS_EMAILABLE_TRANSACTION_PROPERTIES } from '@/tools/quickbooks/types'
import { parseQuickBooksJson } from '@/tools/quickbooks/utils'
import { requiredQuickBooksString } from '@/tools/quickbooks/values'
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
    quickBooksEnvironment: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'QuickBooks API environment derived from the connected credential',
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
        'Required for Customer Payments; otherwise an optional single recipient override',
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
    authoritativeParams: ['realmId', 'quickBooksEnvironment'],
    requiredScopes: ['com.intuit.quickbooks.accounting'],
  },
  errorExtractor: ErrorExtractorId.QUICKBOOKS_FAULT,
  request: {
    url: (params) => {
      if (params.confirmSend !== true)
        throw new Error('Confirm sending before emailing a QuickBooks transaction')
      const { resource } = getQuickBooksDocumentTransaction(params.transactionType)
      const id = requiredQuickBooksString(params.transactionId, 'transactionId')
      const recipient = validateQuickBooksRecipient(params.recipient)
      if (params.transactionType === 'payment' && !recipient) {
        throw new Error('recipient is required when emailing a QuickBooks Customer Payment')
      }
      const url = buildQuickBooksCompanyUrl(
        params.realmId,
        `${resource}/${encodeURIComponent(id)}/send`,
        params.quickBooksEnvironment
      )
      if (recipient) url.searchParams.set('sendTo', recipient)
      return url.toString()
    },
    method: 'POST',
    headers: (params) => ({
      ...buildQuickBooksHeaders(params.accessToken),
      'Content-Type': 'application/octet-stream',
    }),
    retry: { enabled: false },
  },
  transformResponse: async (response, params) => {
    if (!params) throw new Error('QuickBooks Email Transaction parameters are required')
    const { entity } = getQuickBooksDocumentTransaction(params.transactionType)
    const data = await parseQuickBooksJson<Record<string, unknown> & { time?: string }>(
      response,
      `QuickBooks ${entity} email response`
    )
    const record = data[entity]
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new Error(`QuickBooks ${entity} email response is missing a valid ${entity}`)
    }
    const transactionId = requiredQuickBooksString(params.transactionId, 'transactionId')
    if ((record as { Id?: unknown }).Id !== transactionId) {
      throw new Error(`QuickBooks ${entity} email response returned an unexpected transaction ID`)
    }
    return {
      success: true,
      output: {
        transactionType: params.transactionType,
        transactionId,
        sent: true,
        record: record as QuickBooksTransaction,
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
      properties: QUICKBOOKS_EMAILABLE_TRANSACTION_PROPERTIES,
    },
    time: {
      type: 'string',
      description: 'QuickBooks response timestamp',
      optional: true,
      nullable: true,
    },
  },
}
