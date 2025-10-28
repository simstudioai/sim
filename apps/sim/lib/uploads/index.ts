// Core storage infrastructure - helper functions only

export * as ChatFiles from '@/lib/uploads/contexts/chat'
export * as CopilotFiles from '@/lib/uploads/contexts/copilot'
export * as ExecutionFiles from '@/lib/uploads/contexts/execution'
// Context-specific file managers
export * as WorkspaceFiles from '@/lib/uploads/contexts/workspace'
export { getStorageConfig, type StorageContext } from '@/lib/uploads/core/config-resolver'
// Configuration - feature flags only (configs are internal, use getStorageConfig instead)
export {
  UPLOAD_DIR,
  USE_BLOB_STORAGE,
  USE_S3_STORAGE,
} from '@/lib/uploads/core/setup'
export {
  type CustomStorageConfig,
  type FileInfo,
  getServePathPrefix,
  getStorageProvider,
  isUsingCloudStorage,
} from '@/lib/uploads/core/storage-client'
// Unified storage service (use this for all file operations)
export * as StorageService from '@/lib/uploads/core/storage-service'
// File utilities
export {
  bufferToBase64,
  createFileContent as createAnthropicFileContent,
  type FileAttachment,
  getContentType as getAnthropicContentType,
  getFileExtension,
  getMimeTypeFromExtension,
  isSupportedFileType,
  type MessageContent as AnthropicMessageContent,
  MIME_TYPE_MAPPING,
} from '@/lib/uploads/utils/file-utils'
