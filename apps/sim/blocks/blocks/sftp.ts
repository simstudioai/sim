import { SftpIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { SftpUploadResult } from '@/tools/sftp/types'

export const SftpBlock: BlockConfig<SftpUploadResult> = {
  type: 'sftp',
  name: 'SFTP',
  description: 'Transfer files via SFTP (SSH File Transfer Protocol)',
  longDescription:
    'Upload, download, list, and manage files on remote servers via SFTP. Supports both password and private key authentication for secure file transfers.',
  docsLink: 'https://docs.sim.ai/tools/sftp',
  category: 'tools',
  bgColor: '#2D3748',
  icon: SftpIcon,
  authMode: AuthMode.ApiKey,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Upload Files', id: 'sftp_upload' },
        { label: 'Create File', id: 'sftp_create' },
        { label: 'Download File', id: 'sftp_download' },
        { label: 'List Directory', id: 'sftp_list' },
        { label: 'Delete File/Directory', id: 'sftp_delete' },
        { label: 'Create Directory', id: 'sftp_mkdir' },
      ],
      value: () => 'sftp_upload',
    },

    {
      id: 'host',
      title: 'SFTP Host',
      type: 'short-input',
      placeholder: 'sftp.example.com or 192.168.1.100',
      required: true,
    },
    {
      id: 'port',
      title: 'SFTP Port',
      type: 'short-input',
      placeholder: '22',
      value: () => '22',
    },
    {
      id: 'username',
      title: 'Username',
      type: 'short-input',
      placeholder: 'sftp-user',
      required: true,
    },

    {
      id: 'authMethod',
      title: 'Authentication Method',
      type: 'dropdown',
      options: [
        { label: 'Password', id: 'password' },
        { label: 'Private Key', id: 'privateKey' },
      ],
      value: () => 'password',
    },

    {
      id: 'password',
      title: 'Password',
      type: 'short-input',
      password: true,
      placeholder: 'Your SFTP password',
      condition: { field: 'authMethod', value: 'password' },
    },

    {
      id: 'privateKey',
      title: 'Private Key',
      type: 'code',
      placeholder: '-----BEGIN OPENSSH PRIVATE KEY-----\n...',
      condition: { field: 'authMethod', value: 'privateKey' },
    },
    {
      id: 'passphrase',
      title: 'Passphrase',
      type: 'short-input',
      password: true,
      placeholder: 'Passphrase for encrypted key (optional)',
      condition: { field: 'authMethod', value: 'privateKey' },
    },

    {
      id: 'remotePath',
      title: 'Remote Path',
      type: 'short-input',
      placeholder: '/home/user/uploads',
      required: true,
    },

    {
      id: 'uploadFiles',
      title: 'Files to Upload',
      type: 'file-upload',
      canonicalParamId: 'files',
      placeholder: 'Select files to upload',
      mode: 'basic',
      multiple: true,
      required: false,
      condition: { field: 'operation', value: 'sftp_upload' },
    },
    {
      id: 'files',
      title: 'File Reference',
      type: 'short-input',
      canonicalParamId: 'files',
      placeholder: 'Reference file from previous block (e.g., {{block_name.file}})',
      mode: 'advanced',
      required: false,
      condition: { field: 'operation', value: 'sftp_upload' },
    },

    {
      id: 'overwrite',
      title: 'Overwrite Existing Files',
      type: 'switch',
      defaultValue: true,
      condition: { field: 'operation', value: ['sftp_upload', 'sftp_create'] },
    },

    {
      id: 'permissions',
      title: 'File Permissions',
      type: 'short-input',
      placeholder: '0644',
      condition: { field: 'operation', value: ['sftp_upload', 'sftp_create'] },
      mode: 'advanced',
    },

    {
      id: 'fileName',
      title: 'File Name',
      type: 'short-input',
      placeholder: 'filename.txt',
      condition: { field: 'operation', value: 'sftp_create' },
      required: true,
    },
    {
      id: 'fileContent',
      title: 'File Content',
      type: 'code',
      placeholder: 'Text content to write to the file',
      condition: { field: 'operation', value: 'sftp_create' },
      required: true,
    },

    {
      id: 'encoding',
      title: 'Output Encoding',
      type: 'dropdown',
      options: [
        { label: 'UTF-8 (Text)', id: 'utf-8' },
        { label: 'Base64 (Binary)', id: 'base64' },
      ],
      value: () => 'utf-8',
      condition: { field: 'operation', value: 'sftp_download' },
    },

    {
      id: 'detailed',
      title: 'Show Detailed Info',
      type: 'switch',
      defaultValue: false,
      condition: { field: 'operation', value: 'sftp_list' },
    },

    {
      id: 'recursive',
      title: 'Recursive Delete',
      type: 'switch',
      defaultValue: false,
      condition: { field: 'operation', value: 'sftp_delete' },
    },

    {
      id: 'mkdirRecursive',
      title: 'Create Parent Directories',
      type: 'switch',
      defaultValue: true,
      condition: { field: 'operation', value: 'sftp_mkdir' },
    },
  ],

  tools: {
    access: ['sftp_upload', 'sftp_download', 'sftp_list', 'sftp_delete', 'sftp_mkdir'],
    config: {
      tool: (params) => {
        const operation = params.operation || 'sftp_upload'
        if (operation === 'sftp_create') return 'sftp_upload'
        return operation
      },
      params: (params) => {
        const connectionConfig: Record<string, unknown> = {
          host: params.host,
          port:
            typeof params.port === 'string' ? Number.parseInt(params.port, 10) : params.port || 22,
          username: params.username,
        }

        if (params.authMethod === 'privateKey') {
          connectionConfig.privateKey = params.privateKey
          if (params.passphrase) {
            connectionConfig.passphrase = params.passphrase
          }
        } else {
          connectionConfig.password = params.password
        }

        const operation = params.operation || 'sftp_upload'

        switch (operation) {
          case 'sftp_upload':
            return {
              ...connectionConfig,
              remotePath: params.remotePath,
              // files is the canonical param from uploadFiles (basic) or files (advanced)
              files: normalizeFileInput(params.files),
              overwrite: params.overwrite !== false,
              permissions: params.permissions,
            }
          case 'sftp_create':
            return {
              ...connectionConfig,
              remotePath: params.remotePath,
              fileContent: params.fileContent,
              fileName: params.fileName,
              overwrite: params.overwrite !== false,
              permissions: params.permissions,
            }
          case 'sftp_download':
            return {
              ...connectionConfig,
              remotePath: params.remotePath,
              encoding: params.encoding || 'utf-8',
            }
          case 'sftp_list':
            return {
              ...connectionConfig,
              remotePath: params.remotePath,
              detailed: params.detailed || false,
            }
          case 'sftp_delete':
            return {
              ...connectionConfig,
              remotePath: params.remotePath,
              recursive: params.recursive || false,
            }
          case 'sftp_mkdir':
            return {
              ...connectionConfig,
              remotePath: params.remotePath,
              recursive: params.mkdirRecursive !== false,
            }
          default:
            return {
              ...connectionConfig,
              remotePath: params.remotePath,
            }
        }
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'SFTP operation to perform' },
    host: { type: 'string', description: 'SFTP server hostname' },
    port: { type: 'number', description: 'SFTP server port' },
    username: { type: 'string', description: 'SFTP username' },
    authMethod: { type: 'string', description: 'Authentication method (password or privateKey)' },
    password: { type: 'string', description: 'Password for authentication' },
    privateKey: { type: 'string', description: 'Private key for authentication' },
    passphrase: { type: 'string', description: 'Passphrase for encrypted key' },
    remotePath: { type: 'string', description: 'Remote path on the SFTP server' },
    files: { type: 'array', description: 'Files to upload (UserFile array)' },
    fileContent: { type: 'string', description: 'Direct content to upload' },
    fileName: { type: 'string', description: 'File name for direct content' },
    overwrite: { type: 'boolean', description: 'Overwrite existing files' },
    permissions: { type: 'string', description: 'File permissions (e.g., 0644)' },
    encoding: { type: 'string', description: 'Output encoding for download' },
    detailed: { type: 'boolean', description: 'Show detailed file info' },
    recursive: { type: 'boolean', description: 'Recursive delete' },
    mkdirRecursive: { type: 'boolean', description: 'Create parent directories' },
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the operation was successful' },
    uploadedFiles: { type: 'json', description: 'Array of uploaded file details' },
    file: { type: 'file', description: 'Downloaded file stored in execution files' },
    fileName: { type: 'string', description: 'Downloaded file name' },
    content: { type: 'string', description: 'Downloaded file content' },
    size: { type: 'number', description: 'File size in bytes' },
    entries: { type: 'json', description: 'Directory listing entries' },
    count: { type: 'number', description: 'Number of entries' },
    deletedPath: { type: 'string', description: 'Path that was deleted' },
    createdPath: { type: 'string', description: 'Directory that was created' },
    message: { type: 'string', description: 'Operation status message' },
    error: { type: 'string', description: 'Error message if operation failed' },
  },
}
