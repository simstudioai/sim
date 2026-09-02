import type { InternalToolConfig, ToolResponse } from '@/tools/types'

const FOLDER_PATH_DESCRIPTION = `Single folder in which to resolve the file name or validate the file ID. Canonical folder path, percent-encoded, e.g. "/memory/user-a/people". The workspace root is "/". Use folderPaths for multiple folders; do not provide both fields.`
const FOLDER_PATHS_DESCRIPTION =
  'Folders to search for the named file or validate the file ID against. The name must resolve to exactly one file across the selected scopes. Do not provide folderPath as well.'

type FileEditMode = 'search_replace' | 'replace_between' | 'insert_after' | 'delete_between'

interface FileEditParams {
  fileName: string
  folderPath?: string
  folderPaths?: string[]
  includeSubfolders?: boolean
  mode: FileEditMode
  search?: string
  content?: string
  replaceAll?: boolean
  beforeAnchor?: string
  afterAnchor?: string
  anchor?: string
  startAnchor?: string
  endAnchor?: string
  occurrence?: number
  workspaceId?: string
}

const EDIT_OUTPUTS = {
  id: { type: 'string' as const, description: 'File ID' },
  name: { type: 'string' as const, description: 'File name' },
  size: { type: 'number' as const, description: 'File size in bytes' },
  lineCount: { type: 'number' as const, description: 'Lines in the file after the edit' },
}

export const fileEditTool: InternalToolConfig<FileEditParams, ToolResponse> = {
  id: 'file_edit',
  name: 'Apply File Edit',
  description:
    'Apply one precise edit to an existing text file without rewriting it. Use search_replace for verbatim replacement, optionally with replaceAll. Use replace_between, insert_after, or delete_between for complete trimmed-line anchors that stay stable when line numbers move. Folder scope can disambiguate a name or constrain a file ID.',
  version: '1.0.0',

  params: {
    fileName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name or ID of the workspace file to edit.',
    },
    folderPath: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: FOLDER_PATH_DESCRIPTION,
    },
    folderPaths: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      maxItems: 64,
      items: { type: 'string' },
      description: FOLDER_PATHS_DESCRIPTION,
    },
    includeSubfolders: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Whether selected folders are searched recursively. Defaults to true; false matches only their direct contents.',
    },
    mode: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Edit type: search_replace, replace_between, insert_after, or delete_between.',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'For search_replace, the exact text to replace, including whitespace and line breaks. It must be unique unless replaceAll is true.',
    },
    content: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Replacement or inserted text. Pass an empty string to delete a search match or clear the text between anchors. Omit only for delete_between.',
    },
    replaceAll: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'For search_replace, replace every non-overlapping match. Defaults to false, which refuses an ambiguous match.',
    },
    beforeAnchor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'For replace_between, the complete line before the content to replace. Leading and trailing whitespace is ignored.',
    },
    afterAnchor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'For replace_between, the complete line after the content to replace. The anchor lines remain in the file.',
    },
    anchor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'For insert_after, the complete line after which content is inserted.',
    },
    startAnchor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'For delete_between, the complete first line to delete. The start anchor is removed.',
    },
    endAnchor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'For delete_between, the complete ending boundary line. The end anchor remains in the file.',
    },
    occurrence: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'For anchored edits, which matching anchor occurrence to use, starting at 1. Defaults to 1.',
    },
  },

  operation: {
    input: (params) => ({
      operation: 'edit',
      fileName: params.fileName,
      folderPath: params.folderPath?.trim() || undefined,
      folderPaths: params.folderPaths,
      ...(params.includeSubfolders === false ? { includeSubfolders: false } : {}),
      mode: params.mode,
      search: params.search,
      ...(params.mode === 'delete_between' ? {} : { content: params.content ?? '' }),
      replaceAll: params.replaceAll,
      beforeAnchor: params.beforeAnchor,
      afterAnchor: params.afterAnchor,
      anchor: params.anchor,
      startAnchor: params.startAnchor,
      endAnchor: params.endAnchor,
      occurrence: params.occurrence,
      workspaceId: params.workspaceId,
    }),
    secretProvenance: {
      request: (params) =>
        params.mode === 'delete_between' ? [] : [{ key: 'content', inputPaths: [['content']] }],
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok || !data.success) {
      return { success: false, output: {}, error: data.error || 'Failed to edit file' }
    }
    return { success: true, output: data.data }
  },

  outputs: EDIT_OUTPUTS,
}
