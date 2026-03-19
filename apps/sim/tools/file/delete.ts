import type { ToolConfig, ToolResponse } from '@/tools/types'

interface FileDeleteParams {
  fileId: string
  workspaceId?: string
}

export const fileDeleteTool: ToolConfig<FileDeleteParams, ToolResponse> = {
  id: 'file_delete',
  name: 'File Delete',
  description: 'Delete a workspace resource file by its ID (soft delete).',
  version: '1.0.0',

  params: {
    fileId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the file to delete.',
    },
  },

  request: {
    url: '/api/tools/sim-file/manage',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      operation: 'delete',
      fileId: params.fileId,
      workspaceId: params.workspaceId || (params as Record<string, unknown>)._context?.workspaceId,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok || !data.success) {
      return { success: false, output: {}, error: data.error || 'Failed to delete file' }
    }
    return { success: true, output: data.data }
  },

  outputs: {
    id: { type: 'string', description: 'Deleted file ID' },
    name: { type: 'string', description: 'Deleted file name' },
  },
}
