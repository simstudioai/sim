import { ROOT_FOLDER_PATH } from '@/lib/folders/paths'
import type { InternalToolConfig, ToolResponse } from '@/tools/types'

/**
 * Folder paths are canonical and percent-encoded: `/Reports/Q3%20Results`. A
 * name containing a slash encodes it as `%2F`, so a path always splits on `/`
 * into exactly its levels. Stating the shape in every description is what stops
 * a model emitting `/My Folder`, which the schema rejects.
 */
const FOLDER_PATH_HINT =
  'Canonical folder path, percent-encoded, e.g. "/Reports/Q3%20Results". The workspace root is "/".'

/**
 * None of these carry a workspace id. The executor mints a delegated principal
 * bound to the run's workspace and the operations read it from there, so a
 * workspace on the input would be a field the caller could set and the server
 * would ignore — the shape that hides a real bug behind a passing schema.
 */
interface ListFoldersParams {
  path?: string
  recursive?: boolean
  depth?: number
  search?: string
  limit?: number
}

interface CreateFolderParams {
  path: string
}

interface UpdateFolderParams {
  path: string
  destinationPath: string
}

interface DeleteFolderParams {
  path: string
  recursive?: boolean
}

interface RestoreFolderParams {
  path: string
}

interface MoveTableParams {
  tableId: string
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

export const tableListFoldersTool: InternalToolConfig<ListFoldersParams, ToolResponse> = {
  id: 'table_list_folders',
  name: 'List Table Folders',
  description:
    'List the folders that organize a workspace’s tables. Lists direct children by default; set Recursive to walk the whole subtree. Use List Tables to see the tables themselves.',
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
        'List every folder beneath the path rather than only its direct children. Each entry carries its depth below the listed folder.',
    },
    depth: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Deepest level to include, counted from the listed folder. 1 is direct children. Setting it implies Recursive, so it can be used on its own.',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Case-insensitive substring match against a folder name. Filters the result, so a deep match is still reported even when its parent folders do not match.',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Most folders to return, 200 by default. A listing cut short comes back with truncated set.',
    },
  },

  operation: {
    input: (params) => ({
      path: optionalText(params.path),
      recursive: params.recursive,
      depth: params.depth,
      search: optionalText(params.search),
      limit: params.limit,
    }),
  },

  transformResponse: transformFolderResponse('Failed to list table folders'),

  outputs: {
    path: { type: 'string', description: 'The folder that was listed.' },
    folders: {
      type: 'array',
      description:
        'The folders inside it. Each carries its name, canonical path, parent path, timestamps, and its depth below the listed folder.',
    },
    truncated: {
      type: 'boolean',
      description: 'True when the limit cut the listing short, so more folders exist.',
    },
  },
}

export const tableCreateFolderTool: InternalToolConfig<CreateFolderParams, ToolResponse> = {
  id: 'table_create_folder',
  name: 'Create Table Folder',
  description:
    'Create a table folder at a path. The parent folder must already exist, so build a nested path one level at a time, top down. Fails if a folder already exists at the path.',
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
      path: optionalText(params.path),
    }),
  },

  transformResponse: transformFolderResponse('Failed to create table folder'),

  outputs: {
    folder: {
      type: 'object',
      description:
        'The created folder, with its name, canonical path, parent path, and timestamps.',
    },
  },
}

export const tableUpdateFolderTool: InternalToolConfig<UpdateFolderParams, ToolResponse> = {
  id: 'table_update_folder',
  name: 'Move Table Folder',
  description:
    'Move or rename a table folder by giving its full destination path. Everything inside the folder, including its tables, moves with it.',
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
      path: optionalText(params.path),
      destinationPath: optionalText(params.destinationPath),
    }),
  },

  transformResponse: transformFolderResponse('Failed to move table folder'),

  outputs: {
    folder: { type: 'object', description: 'The folder at its new path.' },
    previousPath: { type: 'string', description: 'The path the folder had before the move.' },
  },
}

export const tableDeleteFolderTool: InternalToolConfig<DeleteFolderParams, ToolResponse> = {
  id: 'table_delete_folder',
  name: 'Delete Table Folder',
  description:
    'Delete a table folder. It moves to Recently deleted and can be brought back with Restore Table Folder. Deleting a folder that still has contents requires the recursive option.',
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
     * every table inside them, and a model asked to "clean up" a folder will
     * set it on a guess. Only a human configuring the block can turn it on.
     */
    recursive: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description:
        'Also delete the folder’s nested folders and the tables inside them. Without it, deleting a non-empty folder fails.',
    },
  },

  operation: {
    input: (params) => ({
      path: optionalText(params.path),
      recursive: params.recursive,
    }),
  },

  transformResponse: transformFolderResponse('Failed to delete table folder'),

  outputs: {
    path: { type: 'string', description: 'The folder that was deleted.' },
    deleted: { type: 'boolean', description: 'Always true when the operation succeeded.' },
    deletedItems: {
      type: 'object',
      description: 'Counts of the folders and tables deleted alongside it.',
    },
  },
}

export const tableRestoreFolderTool: InternalToolConfig<RestoreFolderParams, ToolResponse> = {
  id: 'table_restore_folder',
  name: 'Restore Table Folder',
  description:
    'Restore a deleted table folder and its contents from Recently deleted. Addressed by the path the folder held when it was deleted; the response reports where it actually landed, which can differ if that path is taken or its parent is still deleted.',
  version: '1.0.0',

  params: {
    path: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: `Path the folder held when it was deleted. ${FOLDER_PATH_HINT}`,
    },
  },

  operation: {
    input: (params) => ({
      path: optionalText(params.path),
    }),
  },

  transformResponse: transformFolderResponse('Failed to restore table folder'),

  outputs: {
    folder: { type: 'object', description: 'The restored folder at its live path.' },
    requestedPath: { type: 'string', description: 'The path the folder was addressed by.' },
    restoredItems: {
      type: 'object',
      description: 'Counts of the folders and tables restored alongside it.',
    },
  },
}

export const tableMoveTool: InternalToolConfig<MoveTableParams, ToolResponse> = {
  id: 'table_move',
  name: 'Move Table',
  description:
    'File an existing table into a folder. Moves the table itself; use Move Table Folder to relocate a whole folder.',
  version: '1.0.0',

  params: {
    tableId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the table to move. Use List Tables to find it.',
    },
    folderPath: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: `Destination folder. Omit to move the table to the workspace root. ${FOLDER_PATH_HINT}`,
    },
  },

  operation: {
    /*
     * An absent destination is sent as the root rather than omitted. The update
     * use case reads an omitted `folderPath` as "leave the folder alone", so
     * dropping it would turn "move this to the root" into a no-op that still
     * reported success.
     */
    input: (params) => ({
      tableId: optionalText(params.tableId),
      folderPath: optionalText(params.folderPath) ?? ROOT_FOLDER_PATH,
    }),
  },

  transformResponse: transformFolderResponse('Failed to move table'),

  outputs: {
    tableId: { type: 'string', description: 'The table that was moved.' },
    name: { type: 'string', description: 'Name of the moved table.' },
    folderPath: { type: 'string', description: 'The folder the table now lives in.' },
  },
}
