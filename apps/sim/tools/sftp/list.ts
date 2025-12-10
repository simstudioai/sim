import type { SftpListParams, SftpListResult } from '@/tools/sftp/types'
import type { ToolConfig } from '@/tools/types'

export const sftpListTool: ToolConfig<SftpListParams, SftpListResult> = {
  id: 'sftp_list',
  name: 'SFTP List Directory',
  description: 'List files and directories on a remote SFTP server',
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
      description: 'Directory path on the remote server',
    },
    detailed: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Include detailed file information (size, permissions, modified date)',
    },
  },

  request: {
    url: '/api/tools/sftp/list',
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
      detailed: params.detailed || false,
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
        error: data.error || 'SFTP list failed',
      }
    }

    return {
      success: true,
      output: {
        success: true,
        path: data.path,
        entries: data.entries,
        count: data.count,
        message: data.message,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the operation was successful' },
    path: { type: 'string', description: 'Directory path that was listed' },
    entries: {
      type: 'json',
      description: 'Array of directory entries with name, type, size, permissions, modifiedAt',
    },
    count: { type: 'number', description: 'Number of entries in the directory' },
    message: { type: 'string', description: 'Operation status message' },
  },
}
