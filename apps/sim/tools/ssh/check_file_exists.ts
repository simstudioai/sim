import type { SSHCheckFileExistsParams, SSHResponse } from '@/tools/ssh/types'
import type { ToolConfig } from '@/tools/types'

export const checkFileExistsTool: ToolConfig<SSHCheckFileExistsParams, SSHResponse> = {
  id: 'ssh_check_file_exists',
  name: 'SSH Check File Exists',
  description: 'Check if a file or directory exists on the remote SSH server',
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
      description: 'Remote file or directory path to check',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Expected type: file, directory, or any (default: any)',
    },
  },

  request: {
    url: '/api/tools/ssh/check-file-exists',
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
      type: params.type || 'any',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'SSH check file exists failed')
    }

    return {
      success: true,
      output: {
        exists: data.exists ?? false,
        type: data.type || 'not_found',
        size: data.size,
        permissions: data.permissions,
        modified: data.modified,
        message: data.message,
      },
    }
  },

  outputs: {
    exists: { type: 'boolean', description: 'Whether the path exists' },
    type: { type: 'string', description: 'Type of path (file, directory, symlink, not_found)' },
    size: { type: 'number', description: 'File size if it is a file' },
    permissions: { type: 'string', description: 'File permissions (e.g., 0755)' },
    modified: { type: 'string', description: 'Last modified timestamp' },
    message: { type: 'string', description: 'Operation status message' },
  },
}
