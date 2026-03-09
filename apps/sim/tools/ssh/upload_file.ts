import type { SSHResponse, SSHUploadFileParams } from '@/tools/ssh/types'
import type { ToolConfig } from '@/tools/types'

export const uploadFileTool: ToolConfig<SSHUploadFileParams, SSHResponse> = {
  id: 'ssh_upload_file',
  name: 'SSH Upload File',
  description: 'Upload a file to a remote SSH server',
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
    fileContent: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'File content to upload (base64 encoded for binary files)',
    },
    fileName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the file being uploaded',
    },
    remotePath: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Destination path on the remote server',
    },
    permissions: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'File permissions (e.g., 0644)',
    },
    overwrite: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Whether to overwrite existing files (default: true)',
    },
  },

  request: {
    url: '/api/tools/ssh/upload-file',
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
      fileContent: params.fileContent,
      fileName: params.fileName,
      remotePath: params.remotePath,
      permissions: params.permissions,
      overwrite: params.overwrite !== false,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'SSH file upload failed')
    }

    return {
      success: true,
      output: {
        uploaded: true,
        remotePath: data.remotePath,
        size: data.size,
        message: data.message,
      },
    }
  },

  outputs: {
    uploaded: { type: 'boolean', description: 'Whether the file was uploaded successfully' },
    remotePath: { type: 'string', description: 'Final path on the remote server' },
    size: { type: 'number', description: 'File size in bytes' },
    message: { type: 'string', description: 'Operation status message' },
  },
}
