import type { InternalToolConfig, ToolResponse } from '@/tools/types'

interface FileWriteParams {
  fileName?: string
  content?: string
  fileInput?: unknown
  contentType?: string
  overwrite?: boolean
  workspaceId?: string
}

export const fileWriteTool: InternalToolConfig<FileWriteParams, ToolResponse> = {
  id: 'file_write',
  name: 'File Write',
  description:
    'Create a new workspace file, either from text content or from an existing file. If a file with the same name already exists, a numeric suffix is added (e.g., "data (1).csv") unless overwrite is enabled.',
  version: '1.0.0',

  params: {
    fileName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'File name (e.g., "data.csv"). Required when writing text; optional when storing a file, which keeps its own name unless this overrides it. If the name already exists, a numeric suffix is added automatically unless overwrite is enabled.',
    },
    content: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The text content to write to the file. Provide exactly one of content or fileInput.',
    },
    fileInput: {
      type: 'file',
      required: false,
      visibility: 'user-or-llm',
      description:
        'An existing file to store in the workspace, such as one produced by an earlier tool. Use this for anything that is not text — PDFs, images, audio, archives. Provide exactly one of content or fileInput.',
    },
    contentType: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'MIME type for new files (e.g., "text/plain"). Auto-detected from the file extension, or taken from the stored file, if omitted.',
    },
    overwrite: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description:
        'Replace the contents of an existing file at the exact target path (folder and name) instead of creating a suffixed copy. Creates the file when that path does not exist yet.',
    },
  },

  operation: {
    input: (params) => ({
      operation: 'write',
      fileName: params.fileName,
      content: params.content,
      fileInput: params.fileInput,
      contentType: params.contentType,
      overwrite: params.overwrite,
      workspaceId: params.workspaceId,
    }),
    secretProvenance: {
      // Only the text branch carries caller-authored content. A stored file's
      // bytes come from an already-tracked object, whose own provenance follows
      // it rather than being re-derived from this request.
      request: () => [{ key: 'content', inputPaths: [['content']] }],
    },
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
