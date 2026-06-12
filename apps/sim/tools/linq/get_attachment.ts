import type { LinqAttachmentResult, LinqGetAttachmentParams } from '@/tools/linq/types'
import { extractLinqError, LINQ_API_BASE, linqHeaders } from '@/tools/linq/utils'
import type { ToolConfig } from '@/tools/types'

export const linqGetAttachmentTool: ToolConfig<LinqGetAttachmentParams, LinqAttachmentResult> = {
  id: 'linq_get_attachment',
  name: 'Get Attachment',
  description: 'Retrieve metadata for an attachment, including its download URL and status',
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
      description: 'The unique identifier of the attachment',
    },
  },

  request: {
    url: (params) =>
      `${LINQ_API_BASE}/attachments/${encodeURIComponent(params.attachmentId.trim())}`,
    method: 'GET',
    headers: (params) => linqHeaders(params.apiKey),
  },

  transformResponse: async (response): Promise<LinqAttachmentResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: extractLinqError(data, 'Failed to get attachment'),
        output: {
          id: '',
          filename: '',
          contentType: '',
          sizeBytes: null,
          status: '',
          downloadUrl: null,
          createdAt: null,
        },
      }
    }

    return {
      success: true,
      output: {
        id: data.id ?? '',
        filename: data.filename ?? '',
        contentType: data.content_type ?? '',
        sizeBytes: data.size_bytes ?? null,
        status: data.status ?? '',
        downloadUrl: data.download_url ?? null,
        createdAt: data.created_at ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Attachment ID' },
    filename: { type: 'string', description: 'File name' },
    contentType: { type: 'string', description: 'MIME type of the file' },
    sizeBytes: { type: 'number', description: 'File size in bytes', optional: true },
    status: { type: 'string', description: 'Upload status (pending, complete, failed)' },
    downloadUrl: { type: 'string', description: 'URL to download the file', optional: true },
    createdAt: { type: 'string', description: 'ISO 8601 creation timestamp', optional: true },
  },
}
