import type {
  QuickBooksDownloadAttachmentParams,
  QuickBooksFileResponse,
} from '@/tools/quickbooks/types'
import { QUICKBOOKS_FILE_OUTPUTS } from '@/tools/quickbooks/types'
import type { InternalToolConfig } from '@/tools/types'

export const quickbooksDownloadAttachmentTool: InternalToolConfig<
  QuickBooksDownloadAttachmentParams,
  QuickBooksFileResponse
> = {
  id: 'quickbooks_download_attachment',
  name: 'QuickBooks Download Attachment',
  description: 'Download a QuickBooks file attachment as a stored Sim file',
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
    authoritativeParams: ['realmId', 'quickBooksEnvironment'],
    requiredScopes: ['com.intuit.quickbooks.accounting'],
  },
  operation: {
    input: (params) => ({
      accessToken: params.accessToken,
      realmId: params.realmId,
      quickBooksEnvironment: params.quickBooksEnvironment,
      attachmentId: params.attachmentId,
      fileName: params.fileName,
    }),
  },
  transformResponse: async (response) => {
    const data = (await response.json()) as QuickBooksFileResponse & { error?: string }
    if (!response.ok || data.success === false) {
      throw new Error(data.error || 'Failed to download QuickBooks attachment')
    }
    return data
  },
  outputs: {
    ...QUICKBOOKS_FILE_OUTPUTS,
    attachmentId: { type: 'string', description: 'Downloaded QuickBooks attachment ID' },
  },
}
