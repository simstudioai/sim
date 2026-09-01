export {
  getStorageConfig,
  isUsingCloudStorage,
  type StorageContext,
} from '@/lib/uploads/config'
export * as ChatFiles from '@/lib/uploads/contexts/chat'
export * as CopilotFiles from '@/lib/uploads/contexts/copilot'
export {
  getFileMetadata,
  getServePathPrefix,
  getStorageProvider,
} from '@/lib/uploads/core/storage-client'
export * as StorageService from '@/lib/uploads/core/storage-service'
