import type { SSHMoveRenameParams, SSHResponse } from '@/tools/ssh/types'
import type { ToolConfig } from '@/tools/types'

export const moveRenameTool: ToolConfig<SSHMoveRenameParams, SSHResponse> = {
  id: 'ssh_move_rename',
  name: 'SSH Move/Rename',
  description: 'Move or rename a file or directory on the remote SSH server',
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
    sourcePath: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Current path of the file or directory',
    },
    destinationPath: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'New path for the file or directory',
    },
    overwrite: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Overwrite destination if it exists (default: false)',
    },
  },

  request: {
    url: '/api/tools/ssh/move-rename',
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
      sourcePath: params.sourcePath,
      destinationPath: params.destinationPath,
      overwrite: params.overwrite === true,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'SSH move/rename failed')
    }

    return {
      success: true,
      output: {
        moved: data.success ?? true,
        sourcePath: data.sourcePath,
        destinationPath: data.destinationPath,
        message: data.message,
      },
    }
  },

  outputs: {
    moved: { type: 'boolean', description: 'Whether the operation was successful' },
    sourcePath: { type: 'string', description: 'Original path' },
    destinationPath: { type: 'string', description: 'New path' },
    message: { type: 'string', description: 'Operation status message' },
  },
}
