export const LOCAL_FILESYSTEM_TOOL_NAMES = {
  mountDirectory: 'local_mount_directory',
  listMounts: 'local_list_mounts',
  forgetMount: 'local_forget_mount',
  list: 'local_list',
  glob: 'local_glob',
  read: 'local_read',
  grep: 'local_grep',
  stat: 'local_stat',
  stageFile: 'local_stage_file',
} as const

const LOCAL_FILESYSTEM_TOOL_NAME_SET = new Set<string>(Object.values(LOCAL_FILESYSTEM_TOOL_NAMES))

export function isLocalFilesystemToolName(name: string): boolean {
  return LOCAL_FILESYSTEM_TOOL_NAME_SET.has(name)
}

const uriProperty = {
  type: 'string',
  description:
    'An opaque localfs:// URI returned by a local filesystem tool. Never use an absolute host path.',
}

function objectSchema(
  properties: Record<string, unknown>,
  required: string[] = []
): Record<string, unknown> {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  }
}

/**
 * Request-local tools advertised only when the renderer proves that it has the
 * Electron desktop bridge. They are client-executed and therefore never enter
 * the static mothership catalog or any subagent allowlist.
 */
export function buildLocalFilesystemToolSchemas() {
  return [
    {
      name: LOCAL_FILESYSTEM_TOOL_NAMES.mountDirectory,
      description:
        'Open the native folder picker so the user can grant the desktop app read-only access to one local directory. The grant is encrypted with the operating-system keychain and remembered across app restarts when secure storage is available. Returns an opaque localfs:// root URI; it never returns the absolute host path. Call this only when no suitable remembered mount exists.',
      input_schema: objectSchema({}),
      executeLocally: true,
    },
    {
      name: LOCAL_FILESYSTEM_TOOL_NAMES.listMounts,
      description:
        'List local directories the user has granted to the desktop app, including remembered grants restored after restart. Returns only display names, remembered status, and opaque localfs:// root URIs.',
      input_schema: objectSchema({}),
      executeLocally: true,
    },
    {
      name: LOCAL_FILESYSTEM_TOOL_NAMES.forgetMount,
      description:
        'Forget and revoke one granted local directory. Use only when the user explicitly asks to remove access. The user must select the directory again before it can be read.',
      input_schema: objectSchema({ uri: uriProperty }, ['uri']),
      executeLocally: true,
    },
    {
      name: LOCAL_FILESYSTEM_TOOL_NAMES.list,
      description:
        'List the immediate children of a granted local directory. This is read-only and returns opaque localfs:// URIs for follow-up calls.',
      input_schema: objectSchema({ uri: uriProperty }, ['uri']),
      executeLocally: true,
    },
    {
      name: LOCAL_FILESYSTEM_TOOL_NAMES.glob,
      description:
        'Find files and directories below a granted local directory using a relative glob such as **/*.ts. Results are bounded and symlinked directories are not traversed.',
      input_schema: objectSchema(
        {
          uri: uriProperty,
          pattern: {
            type: 'string',
            description: 'Relative glob pattern within uri. Absolute paths and .. are rejected.',
          },
        },
        ['uri', 'pattern']
      ),
      executeLocally: true,
    },
    {
      name: LOCAL_FILESYSTEM_TOOL_NAMES.read,
      description:
        'Read a bounded line window from a UTF-8 local text file. Binary and large files must be staged with local_stage_file instead.',
      input_schema: objectSchema(
        {
          uri: uriProperty,
          startLine: {
            type: 'integer',
            minimum: 1,
            description: 'One-based first line. Defaults to 1.',
          },
          lineCount: {
            type: 'integer',
            minimum: 1,
            maximum: 2000,
            description: 'Maximum lines to return. Defaults to 500.',
          },
        },
        ['uri']
      ),
      executeLocally: true,
    },
    {
      name: LOCAL_FILESYSTEM_TOOL_NAMES.grep,
      description:
        'Search text files below a granted local directory for a literal string. Results and scanned files are bounded; binary, large, and symlinked files are skipped.',
      input_schema: objectSchema(
        {
          uri: uriProperty,
          query: { type: 'string', description: 'Literal text to find.' },
          include: {
            type: 'string',
            description: 'Optional relative file glob such as **/*.md. Defaults to **/*.',
          },
          caseSensitive: {
            type: 'boolean',
            description: 'Use case-sensitive matching. Defaults to false.',
          },
        },
        ['uri', 'query']
      ),
      executeLocally: true,
    },
    {
      name: LOCAL_FILESYSTEM_TOOL_NAMES.stat,
      description: 'Return read-only metadata for one granted localfs:// file or directory.',
      input_schema: objectSchema({ uri: uriProperty }, ['uri']),
      executeLocally: true,
    },
    {
      name: LOCAL_FILESYSTEM_TOOL_NAMES.stageFile,
      description:
        'Upload one granted local file into this chat and return its uploads/... VFS path. This does not make the file durable. Before passing it to server-side tools such as function_execute or generate_image, call materialize_file with the returned fileName, then use the returned files/... path.',
      input_schema: objectSchema({ uri: uriProperty }, ['uri']),
      executeLocally: true,
    },
  ]
}
