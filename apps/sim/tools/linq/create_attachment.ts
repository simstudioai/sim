import type { LinqCreateAttachmentParams, LinqCreateAttachmentResult } from '@/tools/linq/types'
import type { ToolConfig } from '@/tools/types'

export const linqCreateAttachmentTool: ToolConfig<
  LinqCreateAttachmentParams,
  LinqCreateAttachmentResult
> = {
  id: 'linq_create_attachment',
  name: 'Upload Attachment',
  description:
    'Upload a file to Linq as a reusable attachment (max 100MB) and get an attachment ID to send in messages',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Linq API key',
    },
    file: {
      type: 'file',
      required: false,
      visibility: 'user-or-llm',
      description: 'File to upload (a UserFile from a file-upload field or a previous block)',
    },
    fileContent: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Legacy base64-encoded file content fallback',
    },
    filename: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Override the file name (defaults to the uploaded file name)',
    },
    contentType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Override the MIME type (defaults to the uploaded file type)',
    },
  },

  request: {
    url: '/api/tools/linq/upload',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      apiKey: params.apiKey,
      file: params.file,
      fileContent: params.fileContent,
      filename: params.filename,
      contentType: params.contentType,
    }),
  },

  transformResponse: async (response): Promise<LinqCreateAttachmentResult> => {
    const data = await response.json()

    if (!response.ok || !data?.success) {
      return {
        success: false,
        error: data?.error ?? 'Failed to upload attachment',
        output: {
          attachmentId: '',
          downloadUrl: null,
          filename: '',
          contentType: '',
          sizeBytes: 0,
          status: '',
        },
      }
    }

    const output = data.output ?? {}
    return {
      success: true,
      output: {
        attachmentId: output.attachmentId ?? '',
        downloadUrl: output.downloadUrl ?? null,
        filename: output.filename ?? '',
        contentType: output.contentType ?? '',
        sizeBytes: output.sizeBytes ?? 0,
        status: output.status ?? '',
      },
    }
  },

  outputs: {
    attachmentId: {
      type: 'string',
      description: 'Reusable attachment ID to reference when sending messages or voice memos',
    },
    downloadUrl: {
      type: 'string',
      description: 'URL the attachment can be downloaded from',
      optional: true,
    },
    filename: { type: 'string', description: 'File name' },
    contentType: { type: 'string', description: 'MIME type of the file' },
    sizeBytes: { type: 'number', description: 'File size in bytes' },
    status: { type: 'string', description: 'Upload status' },
  },
}
