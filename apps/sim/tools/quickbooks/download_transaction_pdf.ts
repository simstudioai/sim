import type {
  QuickBooksDownloadTransactionPdfParams,
  QuickBooksFileResponse,
} from '@/tools/quickbooks/types'
import { QUICKBOOKS_FILE_OUTPUTS } from '@/tools/quickbooks/types'
import type { ToolConfig } from '@/tools/types'

export const quickbooksDownloadTransactionPdfTool: ToolConfig<
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
    requiredScopes: ['com.intuit.quickbooks.accounting'],
  },
  request: {
    url: '/api/tools/quickbooks/download-transaction-pdf',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => params,
  },
  outputs: {
    ...QUICKBOOKS_FILE_OUTPUTS,
    transactionType: { type: 'string', description: 'Downloaded QuickBooks transaction type' },
    transactionId: { type: 'string', description: 'Downloaded QuickBooks transaction ID' },
  },
}
