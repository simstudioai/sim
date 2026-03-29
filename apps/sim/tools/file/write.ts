import type { ToolConfig, ToolResponse, WorkflowToolExecutionContext } from '@/tools/types'

interface FileWriteParams {
  fileName: string
  content: string
  contentType?: string
  workspaceId?: string
  _context?: WorkflowToolExecutionContext
}

export const fileWriteTool: ToolConfig<FileWriteParams, ToolResponse> = {
  id: 'file_write',
  name: 'File Write',
  description: 'Create a new workspace file. Fails if a file with the same name already exists.',
  version: '1.0.0',

  params: {
    fileName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'File name (e.g., "data.csv"). Fails if a file with this name already exists.',
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
