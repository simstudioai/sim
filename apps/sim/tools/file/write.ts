import type { ToolConfig, ToolResponse, WorkflowToolExecutionContext } from '@/tools/types'

interface FileWriteParams {
  fileName?: string
  content: string
  contentType?: string
  append?: boolean
  workspaceId?: string
  _context?: WorkflowToolExecutionContext
}

export const fileWriteTool: ToolConfig<FileWriteParams, ToolResponse> = {
  id: 'file_write',
  name: 'File Write',
  description:
    'Write content to a workspace resource file. Provide fileName to create a new file or overwrite an existing one with the same name. Use append mode to add content to the end instead of replacing.',
  version: '1.0.0',

  params: {
    fileName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'File name (e.g., "data.csv"). Creates the file if it does not exist, or overwrites/appends to it if it does.',
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
        'When true, appends content to the end of an existing file. When false (default), replaces the file content entirely.',
    },
  },

  request: {
    url: '/api/tools/file/manage',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      operation: 'write',
      fileName: params.fileName,
      content: params.content,
      contentType: params.contentType,
      append: params.append ?? false,
      workspaceId: params.workspaceId || params._context?.workspaceId,
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
