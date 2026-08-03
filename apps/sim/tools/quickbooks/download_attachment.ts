import { QUICKBOOKS_FILE_TOOL_RESPONSE_MAX_BYTES } from '@/tools/quickbooks/documents_utils'
import type {
  QuickBooksDownloadAttachmentParams,
  QuickBooksFileResponse,
} from '@/tools/quickbooks/types'
import { QUICKBOOKS_FILE_OUTPUTS } from '@/tools/quickbooks/types'
import type { ToolConfig } from '@/tools/types'

export const quickbooksDownloadAttachmentTool: ToolConfig<
  QuickBooksDownloadAttachmentParams,
  QuickBooksFileResponse
> = {
  id: 'quickbooks_download_attachment',
  name: 'QuickBooks Download Attachment',
  description: 'Download a QuickBooks file attachment through its short-lived URL',
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
    attachmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'QuickBooks attachment ID',
    },
    fileName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional safe filename override',
    },
  },
  oauth: {
    required: true,
    provider: 'quickbooks',
    requiredScopes: ['com.intuit.quickbooks.accounting'],
  },
  request: {
    url: '/api/tools/quickbooks/download-attachment',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => params,
    maxResponseBytes: QUICKBOOKS_FILE_TOOL_RESPONSE_MAX_BYTES,
  },
  outputs: {
    ...QUICKBOOKS_FILE_OUTPUTS,
    attachmentId: { type: 'string', description: 'Downloaded QuickBooks attachment ID' },
  },
}
