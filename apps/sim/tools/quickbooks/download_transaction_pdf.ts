import { QUICKBOOKS_INTERNAL_FILE_RESPONSE_MAX_BYTES } from '@/tools/quickbooks/documents_utils'
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
    url: '/api/tools/quickbooks/download-document',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      documentKind: 'transaction_pdf',
      accessToken: params.accessToken,
      realmId: params.realmId,
      transactionType: params.transactionType,
      transactionId: params.transactionId,
      fileName: params.fileName,
      workspaceId:
        typeof params._context?.workspaceId === 'string' ? params._context.workspaceId : undefined,
      workflowId:
        typeof params._context?.workflowId === 'string' ? params._context.workflowId : undefined,
      executionId:
        typeof params._context?.executionId === 'string' ? params._context.executionId : undefined,
    }),
    maxResponseBytes: QUICKBOOKS_INTERNAL_FILE_RESPONSE_MAX_BYTES,
  },
  outputs: {
    ...QUICKBOOKS_FILE_OUTPUTS,
    transactionType: { type: 'string', description: 'Downloaded QuickBooks transaction type' },
    transactionId: { type: 'string', description: 'Downloaded QuickBooks transaction ID' },
  },
}
