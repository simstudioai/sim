import type { SSHDeleteFileParams, SSHResponse } from '@/tools/ssh/types'
import type { ToolConfig } from '@/tools/types'

export const deleteFileTool: ToolConfig<SSHDeleteFileParams, SSHResponse> = {
  id: 'ssh_delete_file',
  name: 'SSH Delete File',
  description: 'Delete a file or directory from the remote SSH server',
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
      description: 'Path to delete',
    },
    recursive: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Recursively delete directories (default: false)',
    },
    force: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Force deletion without confirmation (default: false)',
    },
  },

  request: {
    url: '/api/tools/ssh/delete-file',
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
      recursive: params.recursive === true,
      force: params.force === true,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'SSH delete file failed')
    }

    return {
      success: true,
      output: {
        deleted: data.deleted ?? true,
        remotePath: data.path,
        message: data.message,
      },
    }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the path was deleted successfully' },
    remotePath: { type: 'string', description: 'Deleted path' },
    message: { type: 'string', description: 'Operation status message' },
  },
}
