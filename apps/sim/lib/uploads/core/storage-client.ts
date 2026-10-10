import { USE_BLOB_STORAGE, USE_GCS_STORAGE, USE_S3_STORAGE } from '@/lib/uploads/config'
import type { StorageConfig } from '@/lib/uploads/shared/types'

export type { StorageConfig } from '@/lib/uploads/shared/types'

/**
 * Get the serve path prefix (unified across all storage providers)
 */
export function getServePathPrefix(): string {
  return '/api/files/serve/'
}

/**
 * Read raw object metadata from the configured provider; it is not canonical file ownership.
 * @param key File key/name
 * @param customConfig Optional custom storage configuration
 * @returns File metadata object with userId, workspaceId, originalName, uploadedAt, etc.
 */
export async function getStorageObjectMetadata(
  key: string,
  customConfig?: StorageConfig
): Promise<Record<string, string>> {
  if (USE_BLOB_STORAGE) {
    const { headBlobObject } = await import('@/lib/uploads/providers/blob/client')
    const { BLOB_CONFIG } = await import('@/lib/uploads/config')
    /** `headBlobObject` rejects a config that names no credentials, so only pass one that does. */
    const credentialed = Boolean(
      customConfig?.connectionString || (customConfig?.accountName && customConfig?.accountKey)
    )
    const object = await headBlobObject(
      key,
      credentialed
        ? {
            ...customConfig,
            containerName: customConfig?.containerName || BLOB_CONFIG.containerName,
          }
        : undefined
    )
    return object?.metadata || {}
  }

  if (USE_S3_STORAGE) {
    const { headS3Object } = await import('@/lib/uploads/providers/s3/client')
    const { S3_CONFIG } = await import('@/lib/uploads/config')
    const bucket = customConfig?.bucket || S3_CONFIG.bucket

    if (!bucket) {
      throw new Error('S3 bucket not configured')
    }

    const object = await headS3Object(key, {
      bucket,
      region: customConfig?.region || S3_CONFIG.region,
    })
    return object?.metadata || {}
  }

  if (USE_GCS_STORAGE) {
    /**
     * Unlike the other two, this raises on a missing object rather than reporting
     * absence, because GCS answers a missing object and a missing bucket the same
     * way and only the caller's own bucket configuration separates them.
     */
    const { getGcsObjectMetadata } = await import(
      '@/lib/uploads/providers/google-cloud-storage/client'
    )
    return getGcsObjectMetadata(
      key,
      customConfig?.bucket ? { bucket: customConfig.bucket } : undefined
    )
  }

  return {}
}
