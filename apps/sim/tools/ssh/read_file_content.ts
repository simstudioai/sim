import type { SSHReadFileContentParams, SSHResponse } from '@/tools/ssh/types'
import type { ToolConfig } from '@/tools/types'

export const readFileContentTool: ToolConfig<SSHReadFileContentParams, SSHResponse> = {
  id: 'ssh_read_file_content',
  name: 'SSH Read File Content',
  description: 'Read the contents of a remote file',
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
      description: 'Remote file path to read',
    },
    encoding: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'File encoding (default: utf-8)',
    },
    maxSize: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum file size to read in MB (default: 10)',
    },
  },

  request: {
    url: '/api/tools/ssh/read-file-content',
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
      encoding: params.encoding || 'utf-8',
      maxSize: params.maxSize || 10,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'SSH read file content failed')
    }

    return {
      success: true,
      output: {
        content: data.content,
        size: data.size,
        lines: data.lines,
        remotePath: data.path,
        message: data.message,
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'File content as string' },
    size: { type: 'number', description: 'File size in bytes' },
    lines: { type: 'number', description: 'Number of lines in file' },
    remotePath: { type: 'string', description: 'Remote file path' },
    message: { type: 'string', description: 'Operation status message' },
  },
}
