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
      maxItems: 64,
      items: { type: 'string' },
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
  description:
    'Read workspace file objects from selected files, canonical workspace file IDs, or one or more workspace folders.',
})

interface FileGetContentParams {
  fileId?: string | string[]
  fileInput?: unknown
  folderPaths?: string[]
  includeSubfolders?: boolean
  offset?: number
  limit?: number
  workspaceId?: string
}

export const fileGetContentTool: InternalToolConfig<FileGetContentParams, ToolResponse> = {
  id: 'file_get_content',
  name: 'File Get Content',
  description:
    'Extract the text content of workspace files selected directly, identified by canonical file ID, or collected from one or more workspace folders.',
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
      maxItems: 64,
      items: { type: 'string' },
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
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'First line to return, 1-based. Applied to each selected file separately, so a multi-file selection returns the same window of each. Absent starts at the first line.',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'How many lines to return from the offset. Absent reads to the end. Use this to read part of a long file instead of all of it; the response reports the total line count alongside the window.',
    },
  },

  operation: {
    input: (params) => ({
      operation: 'content',
      fileId: params.fileId,
      fileInput: params.fileInput,
      folderPaths: params.folderPaths,
      includeSubfolders: params.includeSubfolders,
      offset: params.offset,
      limit: params.limit,
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
    lineRanges: {
      type: 'array',
      description:
        'Present when a line range was requested: one entry per file, in the same order, with offset, lineCount, and totalLines',
    },
  },
}
