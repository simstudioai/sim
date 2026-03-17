import { db } from '@sim/db'
import { document, knowledgeBase, workspaceFile } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull, like, or } from 'drizzle-orm'
import { getFileMetadata } from '@/lib/uploads'
import type { StorageContext } from '@/lib/uploads/config'
import { BLOB_CHAT_CONFIG, S3_CHAT_CONFIG } from '@/lib/uploads/config'
import type { StorageConfig } from '@/lib/uploads/core/storage-client'
import { getFileMetadataByKey } from '@/lib/uploads/server/metadata'
import { inferContextFromKey } from '@/lib/uploads/utils/file-utils'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'
import { isUuid } from '@/executor/constants'

const logger = createLogger('FileAuthorization')

export interface AuthorizationResult {
  granted: boolean
  reason: string
  workspaceId?: string
}

/**
 * Lookup workspace file by storage key from database
 * @param key Storage key to lookup
 * @returns Workspace file info or null if not found
 */
export async function lookupWorkspaceFileByKey(
  key: string,
  options?: { includeDeleted?: boolean }
): Promise<{ workspaceId: string; uploadedBy: string } | null> {
  try {
    const { includeDeleted = false } = options ?? {}
    // Priority 1: Check new workspaceFiles table
    const fileRecord = await getFileMetadataByKey(key, 'workspace', { includeDeleted })

    if (fileRecord) {
      return {
        workspaceId: fileRecord.workspaceId || '',
        uploadedBy: fileRecord.userId,
      }
    }

    // Priority 2: Check legacy workspace_file table (for backward compatibility during migration)
    try {
      const [legacyFile] = await db
        .select({
          workspaceId: workspaceFile.workspaceId,
          uploadedBy: workspaceFile.uploadedBy,
        })
        .from(workspaceFile)
        .where(
          includeDeleted
            ? eq(workspaceFile.key, key)
            : and(eq(workspaceFile.key, key), isNull(workspaceFile.deletedAt))
        )
        .limit(1)

      if (legacyFile) {
        return {
          workspaceId: legacyFile.workspaceId,
          uploadedBy: legacyFile.uploadedBy,
        }
      }
    } catch (legacyError) {
      // Ignore errors when checking legacy table (it may not exist after migration)
      logger.debug('Legacy workspace_file table check failed (may not exist):', legacyError)
    }

    return null
  } catch (error) {
    logger.error('Error looking up workspace file by key:', { key, error })
    return null
  }
}

/**
 * Extract workspace ID from workspace file key pattern
 * Pattern: {workspaceId}/{timestamp}-{random}-{filename}
 */
function extractWorkspaceIdFromKey(key: string): string | null {
  const inferredContext = inferContextFromKey(key)
  if (inferredContext !== 'workspace') {
    return null
  }

  // Use the proper parsing utility from workspace context module
  const parts = key.split('/')
  const workspaceId = parts[0]

  if (workspaceId && isUuid(workspaceId)) {
    return workspaceId
  }

  return null
}

/**
 * Verify file access based on file path patterns and metadata
 * @param cloudKey The file key/path (e.g., "workspace_id/workflow_id/execution_id/filename" or "kb/filename")
 * @param userId The authenticated user ID
 * @param customConfig Optional custom storage configuration
 * @param context Optional explicit storage context
 * @param isLocal Optional flag indicating if this is local storage
 * @returns Promise<boolean> True if user has access, false otherwise
 */
export async function verifyFileAccess(
  cloudKey: string,
  userId: string,
  customConfig?: StorageConfig,
  context?: StorageContext,
  isLocal?: boolean
): Promise<boolean> {
  try {
    // Infer context from key if not explicitly provided
    const inferredContext = context || inferContextFromKey(cloudKey)

    // 0. Profile pictures: Public access (anyone can view creator profile pictures)
    if (inferredContext === 'profile-pictures') {
      logger.info('Profile picture access allowed (public)', { cloudKey })
      return true
    }

    // 1. Workspace / mothership files: Check database first (most reliable for both local and cloud)
    if (inferredContext === 'workspace' || inferredContext === 'mothership') {
      return await verifyWorkspaceFileAccess(cloudKey, userId, customConfig, isLocal)
    }

    // 2. Execution files: workspace_id/workflow_id/execution_id/filename
    if (inferredContext === 'execution') {
      return await verifyExecutionFileAccess(cloudKey, userId, customConfig)
    }

    // 3. Copilot files: Check database first, then metadata, then path pattern (legacy)
    if (inferredContext === 'copilot') {
      return await verifyCopilotFileAccess(cloudKey, userId, customConfig)
    }

    // 4. KB files: kb/filename
    if (inferredContext === 'knowledge-base') {
      return await verifyKBFileAccess(cloudKey, userId, customConfig)
    }

    // 5. Chat files: chat/filename
    if (inferredContext === 'chat') {
      return await verifyChatFileAccess(cloudKey, userId, customConfig)
    }

    // 6. Regular uploads: UUID-filename or timestamp-filename
    // Check metadata for userId/workspaceId, or database for workspace files
    return await verifyRegularFileAccess(cloudKey, userId, customConfig, isLocal)
  } catch (error) {
    logger.error('Error verifying file access:', { cloudKey, userId, error })
    // Deny access on error to be safe
    return false
  }
}

/**
 * Verify access to workspace files
 * Priority: Database lookup > Metadata > Deny
 */
async function verifyWorkspaceFileAccess(
  cloudKey: string,
  userId: string,
  customConfig?: StorageConfig,
  isLocal?: boolean
): Promise<boolean> {
  try {
    const anyWorkspaceFileRecord = await getFileMetadataByKey(cloudKey, 'workspace', {
      includeDeleted: true,
    })
    if (anyWorkspaceFileRecord?.deletedAt) {
      logger.warn('Workspace file access denied for archived file', {
        userId,
        cloudKey,
      })
      return false
    }

    // Priority 1: Check database (most reliable, works for both local and cloud)
    const workspaceFileRecord = await lookupWorkspaceFileByKey(cloudKey)
    if (workspaceFileRecord) {
      const permission = await getUserEntityPermissions(
        userId,
        'workspace',
        workspaceFileRecord.workspaceId
      )
      if (permission !== null) {
        logger.debug('Workspace file access granted (database lookup)', {
          userId,
          workspaceId: workspaceFileRecord.workspaceId,
          cloudKey,
        })
        return true
      }
      logger.warn('User does not have workspace access for file', {
        userId,
        workspaceId: workspaceFileRecord.workspaceId,
        cloudKey,
      })
      return false
    }

    // Priority 2: Check metadata (works for both local and cloud files)
    const config: StorageConfig = customConfig || {}
    const metadata = await getFileMetadata(cloudKey, config)
    const workspaceId = metadata.workspaceId

    if (workspaceId) {
      const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
      if (permission !== null) {
        logger.debug('Workspace file access granted (metadata)', {
          userId,
          workspaceId,
          cloudKey,
        })
        return true
      }
      logger.warn('User does not have workspace access for file (metadata)', {
        userId,
        workspaceId,
        cloudKey,
      })
      return false
    }

    logger.warn('Workspace file missing authorization metadata', { cloudKey, userId })
    return false
  } catch (error) {
    logger.error('Error verifying workspace file access', { cloudKey, userId, error })
    return false
  }
}

/**
 * Verify access to execution files
 * Modern format: execution/workspace_id/workflow_id/execution_id/filename
 * Legacy format: workspace_id/workflow_id/execution_id/filename
 */
async function verifyExecutionFileAccess(
  cloudKey: string,
  userId: string,
  customConfig?: StorageConfig
): Promise<boolean> {
  const parts = cloudKey.split('/')

  // Determine if this is modern prefixed or legacy format
  let workspaceId: string
  if (parts[0] === 'execution') {
    // Modern format: execution/workspaceId/workflowId/executionId/filename
    if (parts.length < 5) {
      logger.warn('Invalid execution file path format (modern)', { cloudKey })
      return false
    }
    workspaceId = parts[1]
  } else {
    // Legacy format: workspaceId/workflowId/executionId/filename
    if (parts.length < 4) {
      logger.warn('Invalid execution file path format (legacy)', { cloudKey })
      return false
    }
    workspaceId = parts[0]
  }

  if (!workspaceId) {
    logger.warn('Could not extract workspaceId from execution file path', { cloudKey })
    return false
  }

  const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
  if (permission === null) {
    logger.warn('User does not have workspace access for execution file', {
      userId,
      workspaceId,
      cloudKey,
    })
    return false
  }

  logger.debug('Execution file access granted', { userId, workspaceId, cloudKey })
  return true
}

/**
 * Verify access to copilot files
 * Priority: Database lookup > Metadata > Path pattern (legacy)
 */
async function verifyCopilotFileAccess(
  cloudKey: string,
  userId: string,
  customConfig?: StorageConfig
): Promise<boolean> {
  try {
    // Priority 1: Check workspaceFiles table (new system)
    const fileRecord = await getFileMetadataByKey(cloudKey, 'copilot')

    if (fileRecord) {
      if (fileRecord.userId === userId) {
        logger.debug('Copilot file access granted (workspaceFiles table)', {
          userId,
          cloudKey,
        })
        return true
      }
      logger.warn('User does not own copilot file', {
        userId,
        fileUserId: fileRecord.userId,
        cloudKey,
      })
      return false
    }

    // Priority 2: Check metadata (for files not yet in database)
    const config: StorageConfig = customConfig || {}
    const metadata = await getFileMetadata(cloudKey, config)
    const fileUserId = metadata.userId

    if (fileUserId) {
      if (fileUserId === userId) {
        logger.debug('Copilot file access granted (metadata)', { userId, cloudKey })
        return true
      }
      logger.warn('User does not own copilot file (metadata)', {
        userId,
        fileUserId,
        cloudKey,
      })
      return false
    }

    // Priority 3: Legacy path pattern check (userId/filename format)
    // This handles old copilot files that may have been stored with userId prefix
    const parts = cloudKey.split('/')
    if (parts.length >= 2) {
      const fileUserId = parts[0]
      if (fileUserId && fileUserId === userId) {
        logger.debug('Copilot file access granted (path pattern)', { userId, cloudKey })
        return true
      }
      logger.warn('User does not own copilot file (path pattern)', {
        userId,
        fileUserId,
        cloudKey,
      })
      return false
    }

    logger.warn('Copilot file missing authorization metadata', { cloudKey, userId })
    return false
  } catch (error) {
    logger.error('Error verifying copilot file access', { cloudKey, userId, error })
    return false
  }
}

/**
 * Verify access to KB files
 * KB files: kb/filename
 */
async function verifyKBFileAccess(
  cloudKey: string,
  userId: string,
  customConfig?: StorageConfig
): Promise<boolean> {
  try {
    const activeKbFileDocuments = await db
      .select({
        workspaceId: knowledgeBase.workspaceId,
      })
      .from(document)
      .innerJoin(knowledgeBase, eq(document.knowledgeBaseId, knowledgeBase.id))
      .where(
        and(
          eq(document.userExcluded, false),
          isNull(document.archivedAt),
          isNull(document.deletedAt),
          isNull(knowledgeBase.deletedAt),
          or(
            like(document.fileUrl, `%${cloudKey}%`),
            like(document.fileUrl, `%${encodeURIComponent(cloudKey)}%`)
          )
        )
      )
      .limit(10)

    for (const doc of activeKbFileDocuments) {
      if (!doc.workspaceId) {
        continue
      }

      const permission = await getUserEntityPermissions(userId, 'workspace', doc.workspaceId)
      if (permission !== null) {
        logger.debug('KB file access granted (active document lookup)', {
          userId,
          workspaceId: doc.workspaceId,
          cloudKey,
        })
        return true
      }
    }

    // KB file access must resolve through an active KB document. Metadata alone is not enough
    // because parent archives intentionally keep the underlying file bytes around for history.
    const fileRecord = await getFileMetadataByKey(cloudKey, 'knowledge-base', {
      includeDeleted: true,
    })

    if (fileRecord?.deletedAt) {
      logger.warn('KB file access denied for deleted file metadata', { userId, cloudKey })
      return false
    }

    logger.warn('KB file access denied because no active KB document matched the file', {
      cloudKey,
      userId,
    })
    return false
  } catch (error) {
    logger.error('Error verifying KB file access', { cloudKey, userId, error })
    return false
  }
}

/**
 * Verify access to chat files
 * Chat files: chat/filename
 */
async function verifyChatFileAccess(
  cloudKey: string,
  userId: string,
  customConfig?: StorageConfig
): Promise<boolean> {
  try {
    const config: StorageConfig = customConfig || (await getChatStorageConfig())

    const metadata = await getFileMetadata(cloudKey, config)
    const workspaceId = metadata.workspaceId

    if (!workspaceId) {
      logger.warn('Chat file missing workspaceId in metadata', { cloudKey, userId })
      return false
    }

    const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
    if (permission === null) {
      logger.warn('User does not have workspace access for chat file', {
        userId,
        workspaceId,
        cloudKey,
      })
      return false
    }

    logger.debug('Chat file access granted', { userId, workspaceId, cloudKey })
    return true
  } catch (error) {
    logger.error('Error verifying chat file access', { cloudKey, userId, error })
    return false
  }
}

/**
 * Verify access to regular uploads
 * Regular uploads: UUID-filename or timestamp-filename
 * Priority: Database lookup (for workspace files) > Metadata > Deny
 */
async function verifyRegularFileAccess(
  cloudKey: string,
  userId: string,
  customConfig?: StorageConfig,
  isLocal?: boolean
): Promise<boolean> {
  try {
    // Priority 1: Check if this might be a workspace file (check database)
    // This handles legacy files that might not have metadata
    const workspaceFileRecord = await lookupWorkspaceFileByKey(cloudKey)
    if (workspaceFileRecord) {
      const permission = await getUserEntityPermissions(
        userId,
        'workspace',
        workspaceFileRecord.workspaceId
      )
      if (permission !== null) {
        logger.debug('Regular file access granted (workspace file from database)', {
          userId,
          workspaceId: workspaceFileRecord.workspaceId,
          cloudKey,
        })
        return true
      }
      logger.warn('User does not have workspace access for file', {
        userId,
        workspaceId: workspaceFileRecord.workspaceId,
        cloudKey,
      })
      return false
    }

    // Priority 2: Check metadata (works for both local and cloud files)
    const config: StorageConfig = customConfig || {}
    const metadata = await getFileMetadata(cloudKey, config)
    const fileUserId = metadata.userId
    const workspaceId = metadata.workspaceId

    // If file has userId, verify ownership
    if (fileUserId) {
      if (fileUserId === userId) {
        logger.debug('Regular file access granted (userId match)', { userId, cloudKey })
        return true
      }
      logger.warn('User does not own file', { userId, fileUserId, cloudKey })
      return false
    }

    // If file has workspaceId, verify workspace membership
    if (workspaceId) {
      const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
      if (permission !== null) {
        logger.debug('Regular file access granted (workspace membership)', {
          userId,
          workspaceId,
          cloudKey,
        })
        return true
      }
      logger.warn('User does not have workspace access for file', {
        userId,
        workspaceId,
        cloudKey,
      })
      return false
    }

    // No ownership info available - deny access for security
    logger.warn('File missing ownership metadata', { cloudKey, userId })
    return false
  } catch (error) {
    logger.error('Error verifying regular file access', { cloudKey, userId, error })
    return false
  }
}

/**
 * Unified authorization function that returns structured result
 */
export async function authorizeFileAccess(
  key: string,
  userId: string,
  context?: StorageContext,
  storageConfig?: StorageConfig,
  isLocal?: boolean
): Promise<AuthorizationResult> {
  const granted = await verifyFileAccess(key, userId, storageConfig, context, isLocal)

  if (granted) {
    let workspaceId: string | undefined
    const inferredContext = context || inferContextFromKey(key)

    if (inferredContext === 'workspace') {
      const record = await lookupWorkspaceFileByKey(key)
      workspaceId = record?.workspaceId
    } else {
      const extracted = extractWorkspaceIdFromKey(key)
      if (extracted) {
        workspaceId = extracted
      }
    }

    return {
      granted: true,
      reason: 'Access granted',
      workspaceId,
    }
  }

  return {
    granted: false,
    reason: 'Access denied - insufficient permissions or file not found',
  }
}

/**
 * Get chat storage configuration based on current storage provider
 */
async function getChatStorageConfig(): Promise<StorageConfig> {
  const { USE_S3_STORAGE, USE_BLOB_STORAGE } = await import('@/lib/uploads/config')

  if (USE_BLOB_STORAGE) {
    return {
      containerName: BLOB_CHAT_CONFIG.containerName,
      accountName: BLOB_CHAT_CONFIG.accountName,
      accountKey: BLOB_CHAT_CONFIG.accountKey,
      connectionString: BLOB_CHAT_CONFIG.connectionString,
    }
  }

  if (USE_S3_STORAGE) {
    return {
      bucket: S3_CHAT_CONFIG.bucket,
      region: S3_CHAT_CONFIG.region,
    }
  }

  return {}
}
