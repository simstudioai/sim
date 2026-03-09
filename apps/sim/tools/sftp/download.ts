import type { SftpDownloadParams, SftpDownloadResult } from '@/tools/sftp/types'
import type { ToolConfig } from '@/tools/types'

export const sftpDownloadTool: ToolConfig<SftpDownloadParams, SftpDownloadResult> = {
  id: 'sftp_download',
  name: 'SFTP Download',
  description: 'Download a file from a remote SFTP server',
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
      description: 'Path to the file on the remote server',
    },
    encoding: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Output encoding: utf-8 for text, base64 for binary (default: utf-8)',
    },
  },

  request: {
    url: '/api/tools/sftp/download',
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
      encoding: params.encoding || 'utf-8',
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
        error: data.error || 'SFTP download failed',
      }
    }

    return {
      success: true,
      output: {
        success: true,
        fileName: data.fileName,
        file: data.file,
        content: data.content,
        size: data.size,
        encoding: data.encoding,
        message: data.message,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the download was successful' },
    file: { type: 'file', description: 'Downloaded file stored in execution files' },
    fileName: { type: 'string', description: 'Name of the downloaded file' },
    content: { type: 'string', description: 'File content (text or base64 encoded)' },
    size: { type: 'number', description: 'File size in bytes' },
    encoding: { type: 'string', description: 'Content encoding (utf-8 or base64)' },
    message: { type: 'string', description: 'Operation status message' },
  },
}
