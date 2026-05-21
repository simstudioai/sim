import {
  PayloadSizeLimitError,
  readResponseToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { uploadExecutionFile } from '@/lib/uploads/contexts/execution'
import type { UserFile } from '@/executor/types'
import type { TypeformFilesParams, TypeformFilesResponse } from '@/tools/typeform/types'
import type { ToolConfig } from '@/tools/types'

const MAX_TYPEFORM_FILE_BYTES = 10 * 1024 * 1024
const MAX_LEGACY_INLINE_FILE_BYTES = 7 * 1024 * 1024

function getExecutionContext(params?: TypeformFilesParams): {
  context?: { workspaceId: string; workflowId: string; executionId: string }
  userId?: string
} {
  const context = (
    params as (TypeformFilesParams & { _context?: Record<string, unknown> }) | undefined
  )?._context
  const workspaceId = typeof context?.workspaceId === 'string' ? context.workspaceId : undefined
  const workflowId = typeof context?.workflowId === 'string' ? context.workflowId : undefined
  const executionId = typeof context?.executionId === 'string' ? context.executionId : undefined
  const userId = typeof context?.userId === 'string' ? context.userId : undefined

  if (!workspaceId || !workflowId || !executionId) {
    return { userId }
  }

  return { context: { workspaceId, workflowId, executionId }, userId }
}

export const filesTool: ToolConfig<TypeformFilesParams, TypeformFilesResponse> = {
  id: 'typeform_files',
  name: 'Typeform Files',
  description: 'Download files uploaded in Typeform responses',
  version: '1.0.0',

  params: {
    formId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Typeform form ID (e.g., "abc123XYZ")',
    },
    responseId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Response ID containing the files (e.g., "resp_xyz789")',
    },
    fieldId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Unique ID of the file upload field',
    },
    filename: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Filename of the uploaded file',
    },
    inline: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Whether to request the file with inline Content-Disposition',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Typeform Personal Access Token',
    },
  },

  request: {
    url: (params: TypeformFilesParams) => {
      const encodedFormId = encodeURIComponent(params.formId)
      const encodedResponseId = encodeURIComponent(params.responseId)
      const encodedFieldId = encodeURIComponent(params.fieldId)
      const encodedFilename = encodeURIComponent(params.filename)

      let url = `https://api.typeform.com/forms/${encodedFormId}/responses/${encodedResponseId}/fields/${encodedFieldId}/files/${encodedFilename}`

      // Add the inline parameter if provided
      if (params.inline !== undefined) {
        url += `?inline=${params.inline}`
      }

      return url
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response, params?: TypeformFilesParams) => {
    // For file downloads, we get the file directly
    const contentType = response.headers.get('content-type') || 'application/octet-stream'
    const contentDisposition = response.headers.get('content-disposition') || ''
    const buffer = await readResponseToBufferWithLimit(response, {
      maxBytes: MAX_TYPEFORM_FILE_BYTES,
      label: 'Typeform file download',
    })

    // Try to extract filename from content-disposition if possible
    let filename = ''
    const filenameMatch = contentDisposition.match(/filename="(.+?)"/)
    if (filenameMatch?.[1]) {
      filename = filenameMatch[1]
    }
    if (!filename && params?.filename) {
      filename = params.filename
    }
    if (!filename) {
      filename = 'typeform-file'
    }

    // Get file URL from the response URL or construct it from parameters if not available
    let fileUrl = response.url

    // If the response URL is not available (common in test environments), construct it from params
    if (!fileUrl && params) {
      const encodedFormId = encodeURIComponent(params.formId)
      const encodedResponseId = encodeURIComponent(params.responseId)
      const encodedFieldId = encodeURIComponent(params.fieldId)
      const encodedFilename = encodeURIComponent(params.filename)

      fileUrl = `https://api.typeform.com/forms/${encodedFormId}/responses/${encodedResponseId}/fields/${encodedFieldId}/files/${encodedFilename}`

      if (params.inline !== undefined) {
        fileUrl += `?inline=${params.inline}`
      }
    }

    const { context, userId } = getExecutionContext(params)
    let storedFile: (UserFile & { mimeType?: string }) | undefined

    if (context) {
      const userFile = await uploadExecutionFile(context, buffer, filename, contentType, userId)
      storedFile = { ...userFile, mimeType: contentType }
    }

    if (!storedFile && buffer.length > MAX_LEGACY_INLINE_FILE_BYTES) {
      throw new PayloadSizeLimitError({
        label: 'Typeform legacy inline file',
        maxBytes: MAX_LEGACY_INLINE_FILE_BYTES,
        observedBytes: buffer.length,
      })
    }

    return {
      success: true,
      output: {
        fileUrl: storedFile?.url || fileUrl || '',
        file: storedFile
          ? {
              ...storedFile,
            }
          : {
              name: filename,
              mimeType: contentType,
              data: buffer.toString('base64'),
              size: buffer.length,
            },
        contentType,
        filename,
      },
    }
  },

  outputs: {
    fileUrl: { type: 'string', description: 'Direct download URL for the uploaded file' },
    file: { type: 'file', description: 'Downloaded file stored in execution files' },
    contentType: { type: 'string', description: 'MIME type of the uploaded file' },
    filename: { type: 'string', description: 'Original filename of the uploaded file' },
  },
}
