import type { SftpMkdirParams, SftpMkdirResult } from '@/tools/sftp/types'
import type { ToolConfig } from '@/tools/types'

export const sftpMkdirTool: ToolConfig<SftpMkdirParams, SftpMkdirResult> = {
  id: 'sftp_mkdir',
  name: 'SFTP Create Directory',
  description: 'Create a directory on a remote SFTP server',
  version: '1.0.0',

  params: {
    host: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'SFTP server hostname or IP address',
    },
    port: {
      type: 'number',
      required: true,
      visibility: 'user-only',
      description: 'SFTP server port (default: 22)',
    },
    username: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'SFTP username',
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
    remotePath: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Path for the new directory',
    },
    recursive: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Create parent directories if they do not exist',
    },
  },

  request: {
    url: '/api/tools/sftp/mkdir',
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
      remotePath: params.remotePath,
      recursive: params.recursive || false,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        output: {
          success: false,
        },
        error: data.error || 'SFTP mkdir failed',
      }
    }

    return {
      success: true,
      output: {
        success: true,
        createdPath: data.createdPath,
        message: data.message,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the directory was created successfully' },
    createdPath: { type: 'string', description: 'Path of the created directory' },
    message: { type: 'string', description: 'Operation status message' },
  },
}
