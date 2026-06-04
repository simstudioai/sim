import { db } from '@sim/db'
import { document, knowledgeBase, workspaceFile } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getFileMetadata } from '@/lib/uploads'
import type { StorageContext } from '@/lib/uploads/config'
import { BLOB_CHAT_CONFIG, S3_CHAT_CONFIG } from '@/lib/uploads/config'
import type { StorageConfig } from '@/lib/uploads/core/storage-client'
import { getFileMetadataByKey } from '@/lib/uploads/server/metadata'
import { inferContextFromKey } from '@/lib/uploads/utils/file-utils'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'
import { isUuid } from '@/executor/constants'

const logger = createLogger('FileAuthorization')

/** Thrown by utility functions when file access is denied, so route handlers can return 404. */
export class FileAccessDeniedError extends Error {
  constructor() {
    super('File not found')
    this.name = 'FileAccessDeniedError'
  }
}

interface AuthorizationResult {
  granted: boolean
  reason: string
  workspaceId?: string
}

type WorkspacePermission = 'read' | 'write' | 'admin'

/**
 * Whether a resolved workspace permission satisfies a file operation. Read and
 * download paths accept any membership; destructive operations (`requireWrite`)
 * require write or admin, matching the permission needed to create the file.
 */
function workspacePermissionSatisfies(
  permission: WorkspacePermission | null,
  requireWrite: boolean
): boolean {
  if (permission === null) return false
  return requireWrite ? permission === 'write' || permission === 'admin' : true
}

/**
 * Lookup workspace file by storage key from database
 * @param key Storage key to lookup
 * @returns Workspace file info or null if not found
 */
async function lookupWorkspaceFileByKey(
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
  context?: StorageContext | 'general',
  isLocal?: boolean,
  options?: { requireWrite?: boolean }
): Promise<boolean> {
  const requireWrite = options?.requireWrite ?? false
  try {
    if (context === 'general') {
      return await verifyRegularFileAccess(cloudKey, userId, customConfig, isLocal, requireWrite)
    }

    // Infer context from key if not explicitly provided
    const inferredContext = context || inferContextFromKey(cloudKey)

    // 0. Public contexts: profile pictures, OG images, and workspace logos are publicly accessible
    if (
      inferredContext === 'profile-pictures' ||
      inferredContext === 'og-images' ||
      inferredContext === 'workspace-logos'
    ) {
      logger.info('Public file access allowed', { cloudKey, context: inferredContext })
      return true
    }

    // 1. Workspace / mothership files: Check database first (most reliable for both local and cloud)
    if (inferredContext === 'workspace' || inferredContext === 'mothership') {
      return await verifyWorkspaceFileAccess(cloudKey, userId, customConfig, isLocal, requireWrite)
    }

    // 2. Execution files: workspace_id/workflow_id/execution_id/filename
    if (inferredContext === 'execution') {
      return await verifyExecutionFileAccess(cloudKey, userId, customConfig, requireWrite)
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
      return await verifyChatFileAccess(cloudKey, userId, customConfig, requireWrite)
    }

    // 6. Regular uploads: UUID-filename or timestamp-filename
    // Check metadata for userId/workspaceId, or database for workspace files
    return await verifyRegularFileAccess(cloudKey, userId, customConfig, isLocal, requireWrite)
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
  isLocal?: boolean,
  requireWrite = false
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
      if (workspacePermissionSatisfies(permission, requireWrite)) {
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
      if (workspacePermissionSatisfies(permission, requireWrite)) {
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
  customConfig?: StorageConfig,
  requireWrite = false
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
  if (!workspacePermissionSatisfies(permission, requireWrite)) {
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
 * Whether an active KB document (non-archived/excluded/deleted, in a
 * non-deleted KB) in the owning workspace references exactly `cloudKey`, matched
 * on the document's persisted canonical `storageKey`. This is an exact, indexed
 * lookup — no URL parsing or wildcard matching at read time. It is a lifecycle
 * signal only: it reflects whether the file is still part of a live KB, not who
 * owns it (ownership comes from the binding).
 */
async function hasActiveKbDocumentForKey(cloudKey: string, workspaceId: string): Promise<boolean> {
  const rows = await db
    .select({ id: document.id })
    .from(document)
    .innerJoin(knowledgeBase, eq(document.knowledgeBaseId, knowledgeBase.id))
    .where(
      and(
        eq(knowledgeBase.workspaceId, workspaceId),
        eq(document.storageKey, cloudKey),
        eq(document.userExcluded, false),
        isNull(document.archivedAt),
        isNull(document.deletedAt),
        isNull(knowledgeBase.deletedAt)
      )
    )
    .limit(1)

  return rows.length > 0
}

/**
 * Verify access to KB files (`kb/<key>`).
 *
 * Authorization is determined entirely by clear state:
 *   1. Ownership — the trusted `workspace_files` binding (exact key) names the
 *      owning workspace; the caller must have permission on it. Ownership is
 *      never inferred from an attacker-authorable `document.fileUrl`.
 *   2. Liveness — an active document must still reference the exact key, so the
 *      retained bytes of an archived document or soft-deleted KB are not
 *      downloadable (the liveness document is not an authorization signal).
 *
 * A missing binding denies (the ownership backfill populates bindings for
 * pre-existing objects before this path is deployed).
 */
async function verifyKBFileAccess(
  cloudKey: string,
  userId: string,
  customConfig?: StorageConfig
): Promise<boolean> {
  try {
    const binding = await getFileMetadataByKey(cloudKey, 'knowledge-base', {
      includeDeleted: true,
    })

    if (!binding) {
      logger.warn('KB file access denied: no ownership binding', { userId, cloudKey })
      return false
    }
    if (binding.deletedAt) {
      logger.warn('KB file access denied for deleted file binding', { userId, cloudKey })
      return false
    }
    if (!binding.workspaceId) {
      logger.warn('KB file binding missing workspace owner', { userId, cloudKey })
      return false
    }

    const permission = await getUserEntityPermissions(userId, 'workspace', binding.workspaceId)
    if (permission === null) {
      logger.warn('User does not have workspace access for KB file', {
        userId,
        workspaceId: binding.workspaceId,
        cloudKey,
      })
      return false
    }

    if (!(await hasActiveKbDocumentForKey(cloudKey, binding.workspaceId))) {
      logger.warn('KB file access denied: no active document references the file', {
        userId,
        cloudKey,
      })
      return false
    }

    logger.debug('KB file access granted (ownership binding)', {
      userId,
      workspaceId: binding.workspaceId,
      cloudKey,
    })
    return true
  } catch (error) {
    logger.error('Error verifying KB file access', { cloudKey, userId, error })
    return false
  }
}

/**
 * Authorize a destructive operation (delete) on a KB file.
 *
 * Binding-only: resolves the owning workspace from the trusted ownership binding
 * and requires write/admin permission. Never uses the transitional read fallback,
 * so a not-yet-bound key cannot be deleted cross-tenant.
 */
export async function verifyKBFileWriteAccess(cloudKey: string, userId: string): Promise<boolean> {
  try {
    const binding = await getFileMetadataByKey(cloudKey, 'knowledge-base')
    if (!binding?.workspaceId) {
      logger.warn('KB file delete denied: no ownership binding', { userId, cloudKey })
      return false
    }
    const permission = await getUserEntityPermissions(userId, 'workspace', binding.workspaceId)
    if (permission !== 'write' && permission !== 'admin') {
      logger.warn('KB file delete denied: write/admin required on owner workspace', {
        userId,
        workspaceId: binding.workspaceId,
        cloudKey,
      })
      return false
    }
    return true
  } catch (error) {
    logger.error('Error verifying KB file write access', { cloudKey, userId, error })
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
  customConfig?: StorageConfig,
  requireWrite = false
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
    if (!workspacePermissionSatisfies(permission, requireWrite)) {
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
  isLocal?: boolean,
  requireWrite = false
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
      if (workspacePermissionSatisfies(permission, requireWrite)) {
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
      if (workspacePermissionSatisfies(permission, requireWrite)) {
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
async function authorizeFileAccess(
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
 * Guard helper for tool routes that download user files from storage.
 *
 * Validates that `key` is a non-empty string, that `userId` is present, and
 * that the authenticated user owns the file. Returns a 404 `NextResponse` on
 * any failure so callers can `return` it immediately; returns `null` when
 * access is granted.
 */
export async function assertToolFileAccess(
  key: unknown,
  userId: string,
  requestId: string,
  routeLogger: ReturnType<typeof createLogger>
): Promise<NextResponse | null> {
  if (typeof key !== 'string' || key.length === 0) {
    routeLogger.warn(`[${requestId}] File access check rejected: missing key`)
    return NextResponse.json({ success: false, error: 'File not found' }, { status: 404 })
  }
  const hasAccess = await verifyFileAccess(key, userId)
  if (!hasAccess) {
    routeLogger.warn(`[${requestId}] File access denied for user`, { userId, key })
    return NextResponse.json({ success: false, error: 'File not found' }, { status: 404 })
  }
  return null
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
