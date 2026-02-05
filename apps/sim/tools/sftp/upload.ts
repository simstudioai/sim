import type { SftpUploadParams, SftpUploadResult } from '@/tools/sftp/types'
import type { ToolConfig } from '@/tools/types'

export const sftpUploadTool: ToolConfig<SftpUploadParams, SftpUploadResult> = {
  id: 'sftp_upload',
  name: 'SFTP Upload',
  description: 'Upload files to a remote SFTP server',
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
      description: 'Destination directory on the remote server',
    },
    files: {
      type: 'file[]',
      required: false,
      visibility: 'hidden',
      description: 'Files to upload',
    },
    fileContent: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Direct file content to upload (for text files)',
    },
    fileName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'File name when using direct content',
    },
    overwrite: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Whether to overwrite existing files (default: true)',
    },
    permissions: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'File permissions (e.g., 0644)',
    },
  },

  request: {
    url: '/api/tools/sftp/upload',
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
      files: params.files,
      fileContent: params.fileContent,
      fileName: params.fileName,
      overwrite: params.overwrite !== false,
      permissions: params.permissions,
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
        error: data.error || 'SFTP upload failed',
      }
    }

    return {
      success: true,
      output: {
        success: true,
        uploadedFiles: data.uploadedFiles,
        message: data.message,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the upload was successful' },
    uploadedFiles: {
      type: 'json',
      description: 'Array of uploaded file details (name, remotePath, size)',
    },
    message: { type: 'string', description: 'Operation status message' },
  },
}
