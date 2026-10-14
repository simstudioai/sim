import { getStorageObjectMetadata } from '@/lib/uploads/core/storage-client'
import type { StorageConfig } from '@/lib/uploads/shared/types'

/**
 * Compatibility projection for legacy key-based authorization. Shared Project files require
 * their Principal-aware operation; their creator must never become a legacy user grant.
 * Owner-aware operations consume canonical metadata through resolveFileOwner instead.
 */
export async function getFileMetadata(
  key: string,
  customConfig?: StorageConfig
): Promise<Record<string, string>> {
  const { getFileMetadataByKey } = await import('@/lib/uploads/server/metadata')
  const metadataRecord = await getFileMetadataByKey(key)

  if (metadataRecord) {
    return {
      ...(metadataRecord.projectId == null &&
      metadataRecord.context !== 'project' &&
      metadataRecord.userId
        ? { userId: metadataRecord.userId }
        : {}),
      workspaceId: metadataRecord.workspaceId || '',
      originalName: metadataRecord.originalName,
      uploadedAt: metadataRecord.uploadedAt.toISOString(),
      purpose: metadataRecord.context,
    }
  }

  return getStorageObjectMetadata(key, customConfig)
}
