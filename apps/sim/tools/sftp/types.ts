import type { UserFile } from '@/executor/types'
import type { ToolFileData, ToolResponse } from '@/tools/types'

interface SftpConnectionConfig {
  host: string
  port: number
  username: string
  password?: string
  privateKey?: string
  passphrase?: string
}

export interface SftpUploadParams extends SftpConnectionConfig {
  remotePath: string
  files?: UserFile[]
  fileContent?: string
  fileName?: string
  overwrite?: boolean
  permissions?: string
}

export interface SftpUploadResult extends ToolResponse {
  output: {
    success: boolean
    uploadedFiles?: Array<{
      name: string
      remotePath: string
      size: number
    }>
    message?: string
  }
}

export interface SftpDownloadParams extends SftpConnectionConfig {
  remotePath: string
  encoding?: 'utf-8' | 'base64'
}

export interface SftpDownloadResult extends ToolResponse {
  output: {
    success: boolean
    fileName?: string
    file?: ToolFileData
    content?: string
    size?: number
    encoding?: string
    message?: string
  }
}

export interface SftpListParams extends SftpConnectionConfig {
  remotePath: string
  detailed?: boolean
}

export interface SftpListResult extends ToolResponse {
  output: {
    success: boolean
    path?: string
    entries?: Array<{
      name: string
      type: 'file' | 'directory' | 'symlink' | 'other'
      size?: number
      permissions?: string
      modifiedAt?: string
    }>
    count?: number
    message?: string
  }
}

export interface SftpDeleteParams extends SftpConnectionConfig {
  remotePath: string
  recursive?: boolean
}

export interface SftpDeleteResult extends ToolResponse {
  output: {
    success: boolean
    deletedPath?: string
    message?: string
  }
}

export interface SftpMkdirParams extends SftpConnectionConfig {
  remotePath: string
  recursive?: boolean
}

export interface SftpMkdirResult extends ToolResponse {
  output: {
    success: boolean
    createdPath?: string
    message?: string
  }
}
