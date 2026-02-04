import type { SSHDownloadFileParams, SSHResponse } from '@/tools/ssh/types'
import type { ToolConfig } from '@/tools/types'

export const downloadFileTool: ToolConfig<SSHDownloadFileParams, SSHResponse> = {
  id: 'ssh_download_file',
  name: 'SSH Download File',
  description: 'Download a file from a remote SSH server',
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
    remotePath: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Path of the file on the remote server',
    },
  },

  request: {
    url: '/api/tools/ssh/download-file',
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
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'SSH file download failed')
    }

    return {
      success: true,
      output: {
        downloaded: true,
        file: data.file,
        fileContent: data.content,
        fileName: data.fileName,
        remotePath: data.remotePath,
        size: data.size,
        message: data.message,
      },
    }
  },

  outputs: {
    downloaded: { type: 'boolean', description: 'Whether the file was downloaded successfully' },
    file: { type: 'file', description: 'Downloaded file stored in execution files' },
    fileContent: { type: 'string', description: 'File content (base64 encoded for binary files)' },
    fileName: { type: 'string', description: 'Name of the downloaded file' },
    remotePath: { type: 'string', description: 'Source path on the remote server' },
    size: { type: 'number', description: 'File size in bytes' },
    message: { type: 'string', description: 'Operation status message' },
  },
}
