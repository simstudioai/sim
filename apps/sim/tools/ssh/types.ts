import type { ToolResponse } from '@/tools/types'

// Base SSH connection configuration
export interface SSHConnectionConfig {
  host: string
  port: number
  username: string
  password?: string
  privateKey?: string
  passphrase?: string
  timeout?: number
  keepaliveInterval?: number
  readyTimeout?: number
}

// Execute Command parameters
export interface SSHExecuteCommandParams extends SSHConnectionConfig {
  command: string
  workingDirectory?: string
}

// Execute Script parameters
export interface SSHExecuteScriptParams extends SSHConnectionConfig {
  script: string
  interpreter?: string
  workingDirectory?: string
}

// Check Command Exists parameters
export interface SSHCheckCommandExistsParams extends SSHConnectionConfig {
  commandName: string
}

// Upload File parameters
export interface SSHUploadFileParams extends SSHConnectionConfig {
  fileContent: string
  fileName: string
  remotePath: string
  permissions?: string
  overwrite?: boolean
}

// Upload Directory parameters
export interface SSHUploadDirectoryParams extends SSHConnectionConfig {
  localDirectory: string
  remoteDirectory: string
  recursive?: boolean
  concurrency?: number
}

// Download File parameters
export interface SSHDownloadFileParams extends SSHConnectionConfig {
  remotePath: string
}

// Download Directory parameters
export interface SSHDownloadDirectoryParams extends SSHConnectionConfig {
  remotePath: string
  recursive?: boolean
}

// List Directory parameters
export interface SSHListDirectoryParams extends SSHConnectionConfig {
  path: string
  detailed?: boolean
  recursive?: boolean
}

// Check File Exists parameters
export interface SSHCheckFileExistsParams extends SSHConnectionConfig {
  path: string
  type?: 'file' | 'directory' | 'any'
}

// Create Directory parameters
export interface SSHCreateDirectoryParams extends SSHConnectionConfig {
  path: string
  recursive?: boolean
  permissions?: string
}

// Delete File parameters
export interface SSHDeleteFileParams extends SSHConnectionConfig {
  path: string
  recursive?: boolean
  force?: boolean
}

// Move/Rename parameters
export interface SSHMoveRenameParams extends SSHConnectionConfig {
  sourcePath: string
  destinationPath: string
  overwrite?: boolean
}

// Get System Info parameters
export interface SSHGetSystemInfoParams extends SSHConnectionConfig {}

// Read File Content parameters
export interface SSHReadFileContentParams extends SSHConnectionConfig {
  path: string
  encoding?: string
  maxSize?: number
}

// Write File Content parameters
export interface SSHWriteFileContentParams extends SSHConnectionConfig {
  path: string
  content: string
  mode?: 'overwrite' | 'append' | 'create'
  permissions?: string
}

// File info interface
export interface SSHFileInfo {
  name: string
  type: 'file' | 'directory' | 'symlink' | 'other'
  size: number
  permissions: string
  modified: string
  owner?: string
  group?: string
}

// System info interface
export interface SSHSystemInfo {
  hostname: string
  os: string
  architecture: string
  uptime: number
  memory: {
    total: number
    free: number
    used: number
  }
  diskSpace: {
    total: number
    free: number
    used: number
  }
}

// Response types
export interface SSHResponse extends ToolResponse {
  output: {
    // Command execution outputs
    stdout?: string
    stderr?: string
    exitCode?: number
    success?: boolean

    // File operation outputs
    uploaded?: boolean
    downloaded?: boolean
    fileContent?: string
    fileName?: string
    remotePath?: string
    localPath?: string
    size?: number

    // Directory listing outputs
    entries?: SSHFileInfo[]
    totalFiles?: number
    totalDirectories?: number

    // File existence check outputs
    exists?: boolean
    type?: 'file' | 'directory' | 'symlink' | 'not_found'
    permissions?: string
    modified?: string

    // System info outputs
    hostname?: string
    os?: string
    architecture?: string
    uptime?: number
    memory?: {
      total: number
      free: number
      used: number
    }
    diskSpace?: {
      total: number
      free: number
      used: number
    }

    // File content outputs
    content?: string
    lines?: number

    // Operation status
    created?: boolean
    deleted?: boolean
    written?: boolean
    moved?: boolean
    alreadyExists?: boolean

    // Command check outputs
    commandExists?: boolean
    commandPath?: string
    version?: string

    // Script execution outputs
    scriptPath?: string

    // Metadata
    message?: string
    metadata?: Record<string, unknown>
  }
}

// Union type for all SSH parameters
export type SSHParams =
  | SSHExecuteCommandParams
  | SSHExecuteScriptParams
  | SSHCheckCommandExistsParams
  | SSHUploadFileParams
  | SSHUploadDirectoryParams
  | SSHDownloadFileParams
  | SSHDownloadDirectoryParams
  | SSHListDirectoryParams
  | SSHCheckFileExistsParams
  | SSHCreateDirectoryParams
  | SSHDeleteFileParams
  | SSHMoveRenameParams
  | SSHGetSystemInfoParams
  | SSHReadFileContentParams
  | SSHWriteFileContentParams
