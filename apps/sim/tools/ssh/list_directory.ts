import type { SSHListDirectoryParams, SSHResponse } from '@/tools/ssh/types'
import type { ToolConfig } from '@/tools/types'

export const listDirectoryTool: ToolConfig<SSHListDirectoryParams, SSHResponse> = {
  id: 'ssh_list_directory',
  name: 'SSH List Directory',
  description: 'List files and directories in a remote directory',
  version: '1.0.0',

  params: {
    host: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'SSH server hostname or IP address',
    },
    port: {
      type: 'number',
      required: true,
      visibility: 'user-only',
      description: 'SSH server port (default: 22)',
    },
    username: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'SSH username',
    },
    password: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Password for authentication (if not using private key)',
    },
    privateKey: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Private key for authentication (OpenSSH format)',
    },
    passphrase: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Passphrase for encrypted private key',
    },
    path: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Remote directory path to list',
    },
    detailed: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Include file details (size, permissions, modified date)',
    },
    recursive: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'List subdirectories recursively (default: false)',
    },
  },

  request: {
    url: '/api/tools/ssh/list-directory',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      host: params.host,
      port: Number(params.port) || 22,
      username: params.username,
      password: params.password,
      privateKey: params.privateKey,
      passphrase: params.passphrase,
      path: params.path,
      detailed: params.detailed !== false,
      recursive: params.recursive === true,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'SSH list directory failed')
    }

    return {
      success: true,
      output: {
        entries: data.entries || [],
        totalFiles: data.totalFiles || 0,
        totalDirectories: data.totalDirectories || 0,
        message: data.message,
      },
    }
  },

  outputs: {
    entries: {
      type: 'array',
      description: 'Array of file and directory entries',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'File or directory name' },
          type: { type: 'string', description: 'Entry type (file, directory, symlink)' },
          size: { type: 'number', description: 'File size in bytes' },
          permissions: { type: 'string', description: 'File permissions' },
          modified: { type: 'string', description: 'Last modified timestamp' },
        },
      },
    },
    totalFiles: { type: 'number', description: 'Total number of files' },
    totalDirectories: { type: 'number', description: 'Total number of directories' },
    message: { type: 'string', description: 'Operation status message' },
  },
}
