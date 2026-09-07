import type {
  QuickBooksDownloadTransactionPdfParams,
  QuickBooksFileResponse,
} from '@/tools/quickbooks/types'
import { QUICKBOOKS_FILE_OUTPUTS } from '@/tools/quickbooks/types'
import type { InternalToolConfig } from '@/tools/types'

export const quickbooksDownloadTransactionPdfTool: InternalToolConfig<
  QuickBooksDownloadTransactionPdfParams,
  QuickBooksFileResponse
> = {
  id: 'quickbooks_download_transaction_pdf',
  name: 'QuickBooks Download Transaction PDF',
  description: 'Download a supported QuickBooks transaction as a bounded PDF file',
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
      description: 'Supported transaction type to download',
    },
    transactionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'QuickBooks transaction ID',
    },
    fileName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional safe PDF filename override',
    },
  },
  oauth: {
    required: true,
    provider: 'quickbooks',
    authoritativeParams: ['realmId', 'quickBooksEnvironment'],
    requiredScopes: ['com.intuit.quickbooks.accounting'],
  },
  operation: {
    input: (params) => ({
      accessToken: params.accessToken,
      realmId: params.realmId,
      quickBooksEnvironment: params.quickBooksEnvironment,
      transactionType: params.transactionType,
      transactionId: params.transactionId,
      fileName: params.fileName,
    }),
  },
  transformResponse: async (response) => {
    const data = (await response.json()) as QuickBooksFileResponse & { error?: string }
    if (!response.ok || data.success === false) {
      throw new Error(data.error || 'Failed to download QuickBooks transaction PDF')
    }
    return data
  },
  outputs: {
    ...QUICKBOOKS_FILE_OUTPUTS,
    transactionType: { type: 'string', description: 'Downloaded QuickBooks transaction type' },
    transactionId: { type: 'string', description: 'Downloaded QuickBooks transaction ID' },
  },
}
