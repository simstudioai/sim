import type { LinqDeleteAttachmentParams, LinqSuccessResult } from '@/tools/linq/types'
import { extractLinqError, LINQ_API_BASE, linqHeaders } from '@/tools/linq/utils'
import type { ToolConfig } from '@/tools/types'

export const linqDeleteAttachmentTool: ToolConfig<LinqDeleteAttachmentParams, LinqSuccessResult> = {
  id: 'linq_delete_attachment',
  name: 'Delete Attachment',
  description: 'Permanently delete an attachment owned by your account',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Linq API key',
    },
    attachmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique identifier of the attachment to delete',
    },
  },

  request: {
    url: (params) =>
      `${LINQ_API_BASE}/attachments/${encodeURIComponent(params.attachmentId.trim())}`,
    method: 'DELETE',
    headers: (params) => linqHeaders(params.apiKey),
  },

  transformResponse: async (response): Promise<LinqSuccessResult> => {
    if (response.ok) {
      return { success: true, output: { success: true } }
    }
    const data = await response.json().catch(() => null)
    return {
      success: false,
      error: extractLinqError(data, 'Failed to delete attachment'),
      output: { success: false },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the attachment was deleted' },
  },
}
