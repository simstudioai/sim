import type { ToolConfig, ToolResponse, WorkflowToolExecutionContext } from '@/tools/types'

interface FileGetParams {
  fileId?: string
  fileInput?: unknown
  workspaceId?: string
  _context?: WorkflowToolExecutionContext
}

interface FileReadParams {
  fileId?: string | string[]
  fileInput?: unknown
  workspaceId?: string
  _context?: WorkflowToolExecutionContext
}

const createFileReadTool = (config: {
  id: 'file_read'
  name: string
  description: string
}): ToolConfig<FileReadParams, ToolResponse> => ({
  id: config.id,
  name: config.name,
  description: config.description,
  version: '1.0.0',

  params: {
    fileId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Canonical workspace file ID, or an array of canonical workspace file IDs.',
    },
    fileInput: {
      type: 'file',
      required: false,
      visibility: 'user-only',
      description: 'Selected workspace file object.',
    },
  },

  request: {
    url: '/api/tools/file/manage',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      operation: 'read',
      fileId: params.fileId,
      fileInput: params.fileInput,
      workspaceId: params.workspaceId || params._context?.workspaceId,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok || !data.success) {
      return { success: false, output: {}, error: data.error || 'Failed to get file' }
    }
    return { success: true, output: data.data }
  },

  outputs: {
    file: { type: 'file', description: 'Workspace file object' },
    files: { type: 'file[]', description: 'Workspace file objects' },
  },
})

export const fileGetTool: ToolConfig<FileGetParams, ToolResponse> = {
  id: 'file_get',
  name: 'File Get',
  description: 'Get a workspace file object from a selected file or canonical workspace file ID.',
  version: '1.0.0',

  params: {
    fileId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Canonical workspace file ID.',
    },
    fileInput: {
      type: 'file',
      required: false,
      visibility: 'user-only',
      description: 'Selected workspace file object.',
    },
  },

  request: {
    url: '/api/tools/file/manage',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      operation: 'get',
      fileId: params.fileId,
      fileInput: params.fileInput,
      workspaceId: params.workspaceId || params._context?.workspaceId,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok || !data.success) {
      return { success: false, output: {}, error: data.error || 'Failed to get file' }
    }
    return { success: true, output: data.data }
  },

  outputs: {
    file: { type: 'file', description: 'Workspace file object' },
  },
}

export const fileReadTool = createFileReadTool({
  id: 'file_read',
  name: 'File Read',
  description: 'Read workspace file objects from selected files or canonical workspace file IDs.',
})
