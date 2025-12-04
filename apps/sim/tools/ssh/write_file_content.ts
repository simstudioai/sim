import type { SSHResponse, SSHWriteFileContentParams } from '@/tools/ssh/types'
import type { ToolConfig } from '@/tools/types'

export const writeFileContentTool: ToolConfig<SSHWriteFileContentParams, SSHResponse> = {
  id: 'ssh_write_file_content',
  name: 'SSH Write File Content',
  description: 'Write or append content to a remote file',
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
      description: 'Remote file path to write to',
    },
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Content to write to the file',
    },
    mode: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Write mode: overwrite, append, or create (default: overwrite)',
    },
    permissions: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'File permissions (e.g., 0644)',
    },
  },

  request: {
    url: '/api/tools/ssh/write-file-content',
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
      content: params.content,
      mode: params.mode || 'overwrite',
      permissions: params.permissions,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'SSH write file content failed')
    }

    return {
      success: true,
      output: {
        written: data.written ?? true,
        remotePath: data.path,
        size: data.size,
        message: data.message,
      },
    }
  },

  outputs: {
    written: { type: 'boolean', description: 'Whether the file was written successfully' },
    remotePath: { type: 'string', description: 'File path' },
    size: { type: 'number', description: 'Final file size in bytes' },
    message: { type: 'string', description: 'Operation status message' },
  },
}
