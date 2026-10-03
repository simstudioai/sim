import { ROOT_FOLDER_PATH } from '@/lib/folders/paths'
import type { InternalToolConfig, ToolResponse } from '@/tools/types'

/**
 * Folder paths are canonical and percent-encoded: `/Reports/Q3%20Results`. A
 * name containing a slash encodes it as `%2F`, so a path always splits on `/`
 * into exactly its levels. Stating the shape in every description is what stops
 * a model emitting `/My Folder`, which the contract rejects.
 */
const FOLDER_PATH_HINT =
  'Canonical folder path, percent-encoded, e.g. "/Reports/Q3%20Results". The workspace root is "/".'

interface FolderToolParams {
  workspaceId?: string
}

interface ListParams extends FolderToolParams {
  path?: string
  recursive?: boolean
  depth?: number
  search?: string
  limit?: number
}

interface CreateFolderParams extends FolderToolParams {
  path: string
}

interface UpdateFolderParams extends FolderToolParams {
  path: string
  destinationPath: string
}

interface DeleteFolderParams extends FolderToolParams {
  path: string
  recursive?: boolean
}

interface RestoreFolderParams extends FolderToolParams {
  folderId: string
}

interface MoveFileParams extends FolderToolParams {
  fileId: string
  folderPath?: string
}

/**
 * Drops a blank value rather than forwarding it. An untouched text field sends
 * `''`, which is not a canonical folder path, so an omitted optional path would
 * otherwise be rejected as malformed instead of read as "not supplied".
 */
function optionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function transformFolderResponse(fallbackError: string) {
  return async (response: Response): Promise<ToolResponse> => {
    const data = await response.json()
    if (!response.ok || !data.success) {
      return { success: false, output: {}, error: data.error || fallbackError }
    }
    return { success: true, output: data.data }
  }
}

export const fileListTool: InternalToolConfig<ListParams, ToolResponse> = {
  id: 'file_list',
  name: 'List Files and Folders',
  description:
    'List what is inside a workspace folder: its subfolders and its files together. Lists direct children by default; set Recursive to walk the whole subtree.',
  version: '1.0.0',

  params: {
    path: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: `Folder to list. Omit to list from the workspace root. ${FOLDER_PATH_HINT}`,
    },
    recursive: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'List everything beneath the path rather than only its direct children. Each entry carries its depth below the listed folder.',
    },
    depth: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Deepest level to include when recursive, counted from the listed folder. 1 is direct children.',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Case-insensitive substring match against an entry name. Filters the result, so a deep match is still reported even when its parent folders do not match.',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Most entries to return, 200 by default. A listing cut short comes back with truncated set.',
    },
  },

  operation: {
    input: (params) => ({
      operation: 'list',
      path: optionalText(params.path),
      recursive: params.recursive,
      depth: params.depth,
      search: optionalText(params.search),
      limit: params.limit,
      workspaceId: params.workspaceId,
    }),
  },

  transformResponse: transformFolderResponse('Failed to list folder contents'),

  outputs: {
    path: { type: 'string', description: 'The folder that was listed.' },
    entries: {
      type: 'array',
      description:
        'What the folder holds. Each entry has kind "folder" or "file", a name, and its depth below the listed folder. A folder carries its own canonical path; a file carries its id, size, type, and the canonical path of the folder holding it.',
    },
    truncated: {
      type: 'boolean',
      description: 'True when the limit cut the listing short, so more entries exist.',
    },
  },
}

export const fileCreateFolderTool: InternalToolConfig<CreateFolderParams, ToolResponse> = {
  id: 'file_create_folder',
  name: 'Create File Folder',
  description:
    'Create a workspace file folder at a path. Parent folders are created as needed. Fails if a folder already exists at the path.',
  version: '1.0.0',

  params: {
    path: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: `Path of the folder to create. ${FOLDER_PATH_HINT}`,
    },
  },

  operation: {
    input: (params) => ({
      operation: 'create_folder',
      path: optionalText(params.path),
      workspaceId: params.workspaceId,
    }),
  },

  transformResponse: transformFolderResponse('Failed to create folder'),

  outputs: {
    folder: {
      type: 'object',
      description:
        'The created folder, with its name, canonical path, parent path, and timestamps.',
    },
  },
}

export const fileUpdateFolderTool: InternalToolConfig<UpdateFolderParams, ToolResponse> = {
  id: 'file_update_folder',
  name: 'Move File Folder',
  description:
    'Move or rename a workspace file folder by giving its full destination path. Everything inside the folder moves with it.',
  version: '1.0.0',

  params: {
    path: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: `Folder to move. ${FOLDER_PATH_HINT}`,
    },
    destinationPath: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: `Full path the folder should have afterwards. Renaming is a destination whose parent is unchanged. ${FOLDER_PATH_HINT}`,
    },
  },

  operation: {
    input: (params) => ({
      operation: 'update_folder',
      path: optionalText(params.path),
      destinationPath: optionalText(params.destinationPath),
      workspaceId: params.workspaceId,
    }),
  },

  transformResponse: transformFolderResponse('Failed to move folder'),

  outputs: {
    folder: { type: 'object', description: 'The folder at its new path.' },
    previousPath: { type: 'string', description: 'The path the folder had before the move.' },
  },
}

export const fileDeleteFolderTool: InternalToolConfig<DeleteFolderParams, ToolResponse> = {
  id: 'file_delete_folder',
  name: 'Delete File Folder',
  description:
    'Delete a workspace file folder. It moves to Recently deleted and can be brought back with Restore File Folder. Deleting a folder that still has contents requires the recursive option.',
  version: '1.0.0',

  params: {
    path: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: `Folder to delete. ${FOLDER_PATH_HINT}`,
    },
    /*
     * user-only by design. A recursive delete takes every nested folder and
     * every file inside them, and a model asked to "clean up" a folder will set
     * it on a guess. Only a human configuring the block can turn it on.
     */
    recursive: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description:
        'Also delete the folder’s nested folders and files. Without it, deleting a non-empty folder fails.',
    },
  },

  operation: {
    input: (params) => ({
      operation: 'delete_folder',
      path: optionalText(params.path),
      recursive: params.recursive,
      workspaceId: params.workspaceId,
    }),
  },

  transformResponse: transformFolderResponse('Failed to delete folder'),

  outputs: {
    path: { type: 'string', description: 'The folder that was deleted.' },
    deleted: { type: 'boolean', description: 'Always true when the operation succeeded.' },
    deletedItems: {
      type: 'object',
      description: 'Counts of the folders and files deleted alongside it.',
    },
  },
}

export const fileRestoreFolderTool: InternalToolConfig<RestoreFolderParams, ToolResponse> = {
  id: 'file_restore_folder',
  name: 'Restore File Folder',
  description:
    'Restore a deleted workspace file folder and its contents from Recently deleted. Addressed by folder ID, because a deleted folder has no live path.',
  version: '1.0.0',

  params: {
    folderId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the deleted folder to restore.',
    },
  },

  operation: {
    input: (params) => ({
      operation: 'restore_folder',
      folderId: optionalText(params.folderId),
      workspaceId: params.workspaceId,
    }),
  },

  transformResponse: transformFolderResponse('Failed to restore folder'),

  outputs: {
    folder: { type: 'object', description: 'The restored folder at its live path.' },
    restoredItems: {
      type: 'object',
      description: 'Counts of the folders and files restored alongside it.',
    },
  },
}

export const fileMoveTool: InternalToolConfig<MoveFileParams, ToolResponse> = {
  id: 'file_move',
  name: 'Move File',
  description:
    'Move an existing workspace file into a folder. Moves the file itself; use Move File Folder to relocate a whole folder.',
  version: '1.0.0',

  params: {
    fileId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Canonical workspace file ID of the file to move.',
    },
    folderPath: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: `Destination folder. Omit to move the file to the workspace root. ${FOLDER_PATH_HINT}`,
    },
  },

  operation: {
    input: (params) => ({
      operation: 'move',
      fileId: params.fileId,
      folderPath: optionalText(params.folderPath) ?? ROOT_FOLDER_PATH,
      workspaceId: params.workspaceId,
    }),
  },

  transformResponse: transformFolderResponse('Failed to move file'),

  outputs: {
    fileId: { type: 'string', description: 'The file that was moved.' },
    folderPath: { type: 'string', description: 'The folder the file now lives in.' },
  },
}
