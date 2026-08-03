import type {
  QuickBooksAddAttachmentParams,
  QuickBooksAddAttachmentResponse,
} from '@/tools/quickbooks/types'
import { QUICKBOOKS_ATTACHABLE_PROPERTIES } from '@/tools/quickbooks/types'
import type { ToolConfig } from '@/tools/types'

export const quickbooksAddAttachmentTool: ToolConfig<
  QuickBooksAddAttachmentParams,
  QuickBooksAddAttachmentResponse
> = {
  id: 'quickbooks_add_attachment',
  name: 'QuickBooks Add Attachment',
  description: 'Attach one supported file or one note to a fixed QuickBooks entity',
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
    attachmentKind: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Attachment kind: file or note',
    },
    targetType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Fixed QuickBooks entity type to attach to',
    },
    targetId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'QuickBooks target entity ID',
    },
    file: {
      type: 'file',
      required: false,
      visibility: 'user-only',
      description: 'Single Sim file to upload',
    },
    fileName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional safe filename override',
    },
    contentType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional compatible QuickBooks MIME type override',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional file attachment description',
    },
    note: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Required nonempty note text in Note mode',
    },
  },
  oauth: {
    required: true,
    provider: 'quickbooks',
    requiredScopes: ['com.intuit.quickbooks.accounting'],
  },
  request: {
    url: '/api/tools/quickbooks/add-attachment',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => params,
  },
  outputs: {
    attachment: {
      type: 'json',
      description: 'Created native QuickBooks attachment metadata',
      properties: QUICKBOOKS_ATTACHABLE_PROPERTIES,
    },
    attachmentId: { type: 'string', description: 'Created QuickBooks attachment ID' },
    attachmentKind: { type: 'string', description: 'Created attachment kind' },
    targetType: { type: 'string', description: 'QuickBooks target entity type' },
    targetId: { type: 'string', description: 'QuickBooks target entity ID' },
    time: {
      type: 'string',
      description: 'QuickBooks response timestamp',
      optional: true,
      nullable: true,
    },
  },
}
