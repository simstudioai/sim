import type { SSHCreateDirectoryParams, SSHResponse } from '@/tools/ssh/types'
import type { ToolConfig } from '@/tools/types'

export const createDirectoryTool: ToolConfig<SSHCreateDirectoryParams, SSHResponse> = {
  id: 'ssh_create_directory',
  name: 'SSH Create Directory',
  description: 'Create a directory on the remote SSH server',
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
      description: 'Directory path to create',
    },
    recursive: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Create parent directories if they do not exist (default: true)',
    },
    permissions: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Directory permissions (default: 0755)',
    },
  },

  request: {
    url: '/api/tools/ssh/create-directory',
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
      recursive: params.recursive !== false,
      permissions: params.permissions || '0755',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'SSH create directory failed')
    }

    return {
      success: true,
      output: {
        created: data.created ?? true,
        remotePath: data.path,
        alreadyExists: data.alreadyExists ?? false,
        message: data.message,
      },
    }
  },

  outputs: {
    created: { type: 'boolean', description: 'Whether the directory was created successfully' },
    remotePath: { type: 'string', description: 'Created directory path' },
    alreadyExists: { type: 'boolean', description: 'Whether the directory already existed' },
    message: { type: 'string', description: 'Operation status message' },
  },
}
