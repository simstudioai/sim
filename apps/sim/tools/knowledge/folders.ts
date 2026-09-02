import type { InternalToolConfig, ToolResponse } from '@/tools/types'

/**
 * Folder paths are canonical and percent-encoded: `/Reports/Q3%20Results`. A
 * name containing a slash encodes it as `%2F`, so a path always splits on `/`
 * into exactly its levels. Stating the shape in every description is what stops
 * a model emitting `/My Folder`, which the contract rejects.
 */
const FOLDER_PATH_HINT =
  'Canonical folder path, percent-encoded, e.g. "/Reports/Q3%20Results". The workspace root is "/".'

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

export const knowledgeListFoldersTool: InternalToolConfig<ListFoldersParams, ToolResponse> = {
  id: 'knowledge_list_folders',
  name: 'List Knowledge Folders',
  description:
    'List what is inside a knowledge folder: its subfolders and its knowledge bases together. Lists direct children by default; set Recursive to walk the whole subtree.',
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
      path: optionalText(params.path),
      recursive: params.recursive,
      depth: params.depth,
      search: optionalText(params.search),
      limit: params.limit,
    }),
  },

  transformResponse: transformFolderResponse('Failed to list knowledge folder contents'),

  outputs: {
    path: { type: 'string', description: 'The folder that was listed.' },
    entries: {
      type: 'array',
      description:
        'What the folder holds. Each entry has kind "folder" or "knowledge_base", a name, and its depth below the listed folder. A folder carries its own canonical path; a knowledge base carries its id, description, document and token counts, and the canonical path of the folder holding it.',
    },
    truncated: {
      type: 'boolean',
      description: 'True when the limit cut the listing short, so more entries exist.',
    },
  },
}

export const knowledgeCreateFolderTool: InternalToolConfig<CreateFolderParams, ToolResponse> = {
  id: 'knowledge_create_folder',
  name: 'Create Knowledge Folder',
  description:
    'Create a knowledge folder at a path. Parent folders are created as needed. Fails if a folder already exists at the path.',
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
    input: (params) => ({ path: optionalText(params.path) }),
  },

  transformResponse: transformFolderResponse('Failed to create knowledge folder'),

  outputs: {
    folder: {
      type: 'object',
      description:
        'The created folder, with its id, name, canonical path, parent path, and timestamps.',
    },
  },
}

export const knowledgeUpdateFolderTool: InternalToolConfig<UpdateFolderParams, ToolResponse> = {
  id: 'knowledge_update_folder',
  name: 'Move Knowledge Folder',
  description:
    'Move or rename a knowledge folder by giving its full destination path. Everything inside the folder moves with it.',
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

  transformResponse: transformFolderResponse('Failed to move knowledge folder'),

  outputs: {
    folder: { type: 'object', description: 'The folder at its new path.' },
    previousPath: { type: 'string', description: 'The path the folder had before the move.' },
  },
}

export const knowledgeDeleteFolderTool: InternalToolConfig<DeleteFolderParams, ToolResponse> = {
  id: 'knowledge_delete_folder',
  name: 'Delete Knowledge Folder',
  description:
    'Delete a knowledge folder. Deleting a folder that still has contents requires the recursive option.',
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
     * every knowledge base inside them, and a model asked to "clean up" a folder
     * will set it on a guess.
     *
     * What that buys, precisely: `createLLMToolSchema` withholds `user-only`
     * params from the agent block's model, so the model driving a workflow
     * cannot set this. It is NOT a server-side guard — `createUserToolSchema`,
     * which the direct tool-execution endpoint publishes, withholds only
     * `hidden`, so an authenticated human calling the tool API can still send
     * it. That is a person acting deliberately with their own workspace rights.
     * Copilot is kept off this operation entirely by
     * `HUMAN_AND_EXECUTOR_PRINCIPAL_POLICY`, because its surface uses the same
     * permissive builder and its caller is a model.
     */
    recursive: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description:
        'Also delete the folder’s nested folders and knowledge bases. Without it, deleting a non-empty folder fails.',
    },
  },

  operation: {
    input: (params) => ({
      path: optionalText(params.path),
      recursive: params.recursive,
    }),
  },

  transformResponse: transformFolderResponse('Failed to delete knowledge folder'),

  outputs: {
    path: { type: 'string', description: 'The folder that was deleted.' },
    deleted: { type: 'boolean', description: 'Always true when the operation succeeded.' },
    deletedItems: {
      type: 'object',
      description: 'Counts of the folders and knowledge bases deleted alongside it.',
    },
  },
}
