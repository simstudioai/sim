import type { ToolConfig, ToolResponse } from '@/tools/types'

interface FileWriteParams {
  fileName?: string
  fileId?: string
  content: string
  contentType?: string
  append?: boolean
  workspaceId?: string
}

export const fileWriteTool: ToolConfig<FileWriteParams, ToolResponse> = {
  id: 'file_write',
  name: 'File Write',
  description:
    'Write content to a workspace resource file. Provide fileName to create a new file, or fileId to update an existing one. Use append mode to add content to the end of an existing file.',
  version: '1.0.0',

  params: {
    fileName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Name for a new file (e.g., "data.csv"). Provide this to create a new file.',
    },
    fileId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of an existing file to update. Provide this to write to an existing file.',
    },
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The text content to write to the file.',
    },
    contentType: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'MIME type for new files (e.g., "text/plain"). Auto-detected from file extension if omitted.',
    },
    append: {
      type: 'boolean',
      required: false,
      default: false,
      visibility: 'user-only',
      description:
        'When true, appends content to the end of an existing file instead of replacing it.',
    },
  },

  request: {
    url: '/api/tools/sim-file/manage',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      operation: 'write',
      fileName: params.fileName,
      fileId: params.fileId,
      content: params.content,
      contentType: params.contentType,
      append: params.append ?? false,
      workspaceId: params.workspaceId || (params as Record<string, unknown>)._context?.workspaceId,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok || !data.success) {
      return { success: false, output: {}, error: data.error || 'Failed to write file' }
    }
    return { success: true, output: data.data }
  },

  outputs: {
    id: { type: 'string', description: 'File ID' },
    name: { type: 'string', description: 'File name' },
    size: { type: 'number', description: 'File size in bytes' },
    url: { type: 'string', description: 'URL to access the file', optional: true },
  },
}
