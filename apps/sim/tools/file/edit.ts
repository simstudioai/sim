import type { InternalToolConfig, ToolResponse } from '@/tools/types'

const FOLDER_PATH_DESCRIPTION = `Folder the file lives in. Naming it targets exactly one file when the same name exists in several folders. Canonical folder path, percent-encoded, e.g. "/memory/user-a/people". The workspace root is "/".`

interface FileEditParams {
  fileName: string
  folderPath?: string
  includeSubfolders?: boolean
  oldString: string
  newString: string
  workspaceId?: string
}

interface FileInsertParams {
  fileName: string
  folderPath?: string
  includeSubfolders?: boolean
  afterLine: number
  content: string
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
  name: 'File Edit',
  description:
    'Replace one exact piece of text in an existing workspace file, leaving the rest untouched. Use this to correct a fact in place instead of rewriting the whole file. The search text must match exactly once: if it appears several times the edit is refused and the matching line numbers are returned, so include enough surrounding text to be unique. Only plain-text files can be edited.',
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
    includeSubfolders: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Whether the folder is searched for the file recursively. Defaults to true; set false to match only its direct contents, which is how a name shared with a file in a nested folder is disambiguated.',
    },
    oldString: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The exact text to replace, matched verbatim including whitespace and line breaks. It must appear exactly once in the file.',
    },
    newString: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The text to put in its place. Pass an empty string to delete the old text.',
    },
  },

  operation: {
    input: (params) => ({
      operation: 'edit',
      fileName: params.fileName,
      folderPath: params.folderPath?.trim() || undefined,
      ...(params.includeSubfolders === false ? { includeSubfolders: false } : {}),
      oldString: params.oldString,
      newString: params.newString,
      workspaceId: params.workspaceId,
    }),
    secretProvenance: {
      request: () => [{ key: 'newString', inputPaths: [['newString']] }],
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

export const fileInsertTool: InternalToolConfig<FileInsertParams, ToolResponse> = {
  id: 'file_insert',
  name: 'File Insert',
  description:
    'Insert new lines into an existing workspace file at a given line, leaving the rest untouched. Use this to add an entry under a heading without rewriting the file. Line numbers are the ones returned by search and by a ranged read. Only plain-text files can be edited.',
  version: '1.0.0',

  params: {
    fileName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name or ID of the workspace file to insert into.',
    },
    folderPath: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: FOLDER_PATH_DESCRIPTION,
    },
    includeSubfolders: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Whether the folder is searched for the file recursively. Defaults to true; set false to match only its direct contents, which is how a name shared with a file in a nested folder is disambiguated.',
    },
    afterLine: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The 1-based line to insert after. Use 0 to insert at the top of the file. A line past the end of the file is refused rather than appended, so read or search first if you are not sure how long the file is.',
    },
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The text to insert. Multiple lines are inserted as multiple lines; no trailing newline is needed.',
    },
  },

  operation: {
    input: (params) => ({
      operation: 'insert',
      fileName: params.fileName,
      folderPath: params.folderPath?.trim() || undefined,
      ...(params.includeSubfolders === false ? { includeSubfolders: false } : {}),
      afterLine: params.afterLine,
      content: params.content,
      workspaceId: params.workspaceId,
    }),
    secretProvenance: {
      request: () => [{ key: 'content', inputPaths: [['content']] }],
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok || !data.success) {
      return { success: false, output: {}, error: data.error || 'Failed to insert into file' }
    }
    return { success: true, output: data.data }
  },

  outputs: EDIT_OUTPUTS,
}
