import { db } from '@sim/db'
import { document, workspaceFile } from '@sim/db/schema'
import { eq, like, or } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { getFileMetadata } from '@/lib/uploads'
import type { StorageContext } from '@/lib/uploads/config'
import {
  BLOB_CHAT_CONFIG,
  BLOB_KB_CONFIG,
  S3_CHAT_CONFIG,
  S3_KB_CONFIG,
} from '@/lib/uploads/config'
import type { StorageConfig } from '@/lib/uploads/core/storage-client'
import { getFileMetadataByKey } from '@/lib/uploads/server/metadata'
import { inferContextFromKey } from '@/lib/uploads/utils/file-utils'

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
  key: string
): Promise<{ workspaceId: string; uploadedBy: string } | null> {
  try {
    // Priority 1: Check new workspaceFiles table
    const fileRecord = await getFileMetadataByKey(key, 'workspace')

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
        .where(eq(workspaceFile.key, key))
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

  // Validate UUID format
  const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
  if (workspaceId && UUID_PATTERN.test(workspaceId)) {
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

    // 1. Workspace files: Check database first (most reliable for both local and cloud)
    if (inferredContext === 'workspace') {
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
    // Priority 1: Check workspaceFiles table (new system)
    const fileRecord = await getFileMetadataByKey(cloudKey, 'knowledge-base')

    if (fileRecord?.workspaceId) {
      const permission = await getUserEntityPermissions(userId, 'workspace', fileRecord.workspaceId)
      if (permission !== null) {
        logger.debug('KB file access granted (workspaceFiles table)', {
          userId,
          workspaceId: fileRecord.workspaceId,
          cloudKey,
        })
        return true
      }
      logger.warn('User does not have workspace access for KB file', {
        userId,
        workspaceId: fileRecord.workspaceId,
        cloudKey,
      })
      return false
    }

    // Priority 2: Check document table via fileUrl (legacy knowledge base files)
    try {
      // Try to find document with matching fileUrl
      const documents = await db
        .select({
          knowledgeBaseId: document.knowledgeBaseId,
        })
        .from(document)
        .where(
          or(
            like(document.fileUrl, `%${cloudKey}%`),
            like(document.fileUrl, `%${encodeURIComponent(cloudKey)}%`)
          )
        )
        .limit(10) // Limit to avoid scanning too many

      // Check each document's knowledge base for workspace access
      for (const doc of documents) {
        const { knowledgeBase } = await import('@sim/db/schema')
        const [kb] = await db
          .select({
            workspaceId: knowledgeBase.workspaceId,
          })
          .from(knowledgeBase)
          .where(eq(knowledgeBase.id, doc.knowledgeBaseId))
          .limit(1)

        if (kb?.workspaceId) {
          const permission = await getUserEntityPermissions(userId, 'workspace', kb.workspaceId)
          if (permission !== null) {
            logger.debug('KB file access granted (document table lookup)', {
              userId,
              workspaceId: kb.workspaceId,
              cloudKey,
            })
            return true
          }
        }
      }
    } catch (docError) {
      logger.debug('Document table lookup failed:', docError)
    }

    // Priority 3: Check cloud storage metadata
    const config: StorageConfig = customConfig || (await getKBStorageConfig())
    const metadata = await getFileMetadata(cloudKey, config)
    const workspaceId = metadata.workspaceId

    if (workspaceId) {
      const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
      if (permission !== null) {
        logger.debug('KB file access granted (cloud metadata)', {
          userId,
          workspaceId,
          cloudKey,
        })
        return true
      }
      logger.warn('User does not have workspace access for KB file', {
        userId,
        workspaceId,
        cloudKey,
      })
      return false
    }

    logger.warn('KB file missing workspaceId in all sources', { cloudKey, userId })
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
 * Get KB storage configuration based on current storage provider
 */
async function getKBStorageConfig(): Promise<StorageConfig> {
  const { USE_S3_STORAGE, USE_BLOB_STORAGE } = await import('@/lib/uploads/config')

  if (USE_BLOB_STORAGE) {
    return {
      containerName: BLOB_KB_CONFIG.containerName,
      accountName: BLOB_KB_CONFIG.accountName,
      accountKey: BLOB_KB_CONFIG.accountKey,
      connectionString: BLOB_KB_CONFIG.connectionString,
    }
  }

  if (USE_S3_STORAGE) {
    return {
      bucket: S3_KB_CONFIG.bucket,
      region: S3_KB_CONFIG.region,
    }
  }

  return {}
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
