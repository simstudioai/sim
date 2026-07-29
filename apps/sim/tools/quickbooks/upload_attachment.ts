import type {
  QuickBooksUploadAttachmentParams,
  QuickBooksUploadAttachmentResponse,
} from '@/tools/quickbooks/types'
import type { ToolConfig } from '@/tools/types'

export const quickBooksUploadAttachmentTool: ToolConfig<
  QuickBooksUploadAttachmentParams,
  QuickBooksUploadAttachmentResponse
> = {
  id: 'quickbooks_upload_attachment',
  name: 'QuickBooks Upload Attachment',
  description: 'Upload and link a file to a QuickBooks transaction or list entity',
  version: '1.0.0',
  oauth: { required: true, provider: 'quickbooks' },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for QuickBooks Online',
    },
    realmId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'QuickBooks company ID returned by Intuit as realmId during OAuth',
    },
    file: {
      type: 'file',
      required: true,
      visibility: 'user-only',
      description: 'File to upload and link in QuickBooks',
    },
    entity: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'QuickBooks entity type to link the attachment to',
    },
    entityId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'QuickBooks entity ID to link the attachment to',
    },
    note: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional note stored with the attachment',
    },
    includeOnSend: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include the attachment when QuickBooks sends the linked transaction',
    },
    apiEnvironment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'QuickBooks API environment: production or sandbox. Defaults to production.',
    },
    minorVersion: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'QuickBooks Accounting API minor version. Defaults to 75.',
    },
  },
  request: {
    url: '/api/tools/quickbooks/upload-attachment',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      accessToken: params.accessToken,
      realmId: params.realmId,
      file: params.file,
      entity: params.entity,
      entityId: params.entityId,
      note: params.note,
      includeOnSend:
        typeof params.includeOnSend === 'boolean'
          ? params.includeOnSend
          : params.includeOnSend === 'true',
      apiEnvironment: params.apiEnvironment,
      minorVersion: params.minorVersion,
    }),
  },
  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok || data.success !== true) {
      throw new Error(data.error || 'Failed to upload QuickBooks attachment')
    }
    return { success: true, output: { result: data.output.result } }
  },
  outputs: {
    result: {
      type: 'json',
      description: 'QuickBooks attachment upload response',
    },
  },
}
