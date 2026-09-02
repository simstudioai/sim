import type { InternalToolConfig, ToolResponse } from '@/tools/types'

interface FileGetParams {
  fileId?: string
  fileInput?: unknown
  workspaceId?: string
}

interface FileReadParams {
  fileId?: string | string[]
  fileInput?: unknown
  folderPaths?: string[]
  includeSubfolders?: boolean
  workspaceId?: string
}

const createFileReadTool = (config: {
  id: 'file_read'
  name: string
  description: string
}): InternalToolConfig<FileReadParams, ToolResponse> => ({
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
    folderPaths: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Folders whose files are included, as canonical percent-encoded paths, e.g. ["/Reports/Q3%20Results"]. Nested folders are included by default, and the folders are read at run time, so a file added later is picked up.',
    },
    includeSubfolders: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Whether nested folders are read too. Defaults to true; set false to take only the folders\u2019 direct files.',
    },
  },

  operation: {
    input: (params) => ({
      operation: 'read',
      fileId: params.fileId,
      fileInput: params.fileInput,
      folderPaths: params.folderPaths,
      includeSubfolders: params.includeSubfolders,
      workspaceId: params.workspaceId,
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
    files: { type: 'file[]', description: 'Workspace file objects' },
  },
})

export const fileGetTool: InternalToolConfig<FileGetParams, ToolResponse> = {
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

  operation: {
    input: (params) => ({
      operation: 'get',
      fileId: params.fileId,
      fileInput: params.fileInput,
      workspaceId: params.workspaceId,
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

interface FileGetContentParams {
  fileId?: string | string[]
  fileInput?: unknown
  folderPaths?: string[]
  includeSubfolders?: boolean
  workspaceId?: string
}

export const fileGetContentTool: InternalToolConfig<FileGetContentParams, ToolResponse> = {
  id: 'file_get_content',
  name: 'File Get Content',
  description:
    'Extract the text content of one or more workspace files from selected file objects or canonical workspace file IDs.',
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
      description: 'Selected workspace file object, or an array of file objects.',
    },
    folderPaths: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Folders whose files are included, as canonical percent-encoded paths, e.g. ["/Reports/Q3%20Results"]. Nested folders are included by default, and the folders are read at run time, so a file added later is picked up.',
    },
    includeSubfolders: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Whether nested folders are read too. Defaults to true; set false to take only the folders\u2019 direct files.',
    },
  },

  operation: {
    input: (params) => ({
      operation: 'content',
      fileId: params.fileId,
      fileInput: params.fileInput,
      folderPaths: params.folderPaths,
      includeSubfolders: params.includeSubfolders,
      workspaceId: params.workspaceId,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok || !data.success) {
      return { success: false, output: {}, error: data.error || 'Failed to read file content' }
    }
    return { success: true, output: data.data }
  },

  outputs: {
    contents: {
      type: 'array',
      description: 'Array of file text contents, one entry per file in input order',
    },
  },
}
