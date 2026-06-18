import type { ToolConfig, ToolResponse, WorkflowToolExecutionContext } from '@/tools/types'

interface FileCompressParams {
  fileId?: string | string[]
  fileInput?: unknown
  archiveName?: string
  workspaceId?: string
  _context?: WorkflowToolExecutionContext
}

export const fileCompressTool: ToolConfig<FileCompressParams, ToolResponse> = {
  id: 'file_compress',
  name: 'File Compress',
  description:
    'Compress one or more workspace files into a single .zip archive stored in the workspace, for bundling files to download, transfer, or store.',
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
    archiveName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Name for the .zip archive (e.g., "documents.zip"). Defaults to the source file name when compressing a single file, otherwise "archive.zip".',
    },
  },

  request: {
    url: '/api/tools/file/manage',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      operation: 'compress',
      fileId: params.fileId,
      fileInput: params.fileInput,
      archiveName: params.archiveName,
      workspaceId: params.workspaceId || params._context?.workspaceId,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok || !data.success) {
      return { success: false, output: {}, error: data.error || 'Failed to compress files' }
    }
    return { success: true, output: data.data }
  },

  outputs: {
    id: { type: 'string', description: 'Compressed archive file ID' },
    name: { type: 'string', description: 'Compressed archive file name' },
    size: { type: 'number', description: 'Compressed archive size in bytes' },
    url: { type: 'string', description: 'URL to access the compressed archive', optional: true },
    files: {
      type: 'file[]',
      description: 'Compressed archive file object, as a single-item array',
    },
  },
}

interface FileDecompressParams {
  fileId?: string
  fileInput?: unknown
  workspaceId?: string
  _context?: WorkflowToolExecutionContext
}

export const fileDecompressTool: ToolConfig<FileDecompressParams, ToolResponse> = {
  id: 'file_decompress',
  name: 'File Decompress',
  description:
    'Extract the contents of a .zip archive into the workspace, preserving the archive folder structure.',
  version: '1.0.0',

  params: {
    fileId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Canonical workspace file ID of the .zip archive to extract.',
    },
    fileInput: {
      type: 'file',
      required: false,
      visibility: 'user-only',
      description: 'Selected .zip archive file object.',
    },
  },

  request: {
    url: '/api/tools/file/manage',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      operation: 'decompress',
      fileId: params.fileId,
      fileInput: params.fileInput,
      workspaceId: params.workspaceId || params._context?.workspaceId,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok || !data.success) {
      return { success: false, output: {}, error: data.error || 'Failed to decompress archive' }
    }
    return { success: true, output: data.data }
  },

  outputs: {
    files: { type: 'file[]', description: 'Extracted workspace file objects' },
  },
}
