import { db } from '@sim/db'
import { document, knowledgeBase, workspaceFile } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, asc, eq, isNull, like, or } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getEnv } from '@/lib/core/config/env'
import { getBaseUrl, getInternalApiBaseUrl, parseOriginList } from '@/lib/core/utils/urls'
import { getFileMetadata } from '@/lib/uploads'
import type { StorageContext } from '@/lib/uploads/config'
import { BLOB_CHAT_CONFIG, S3_CHAT_CONFIG } from '@/lib/uploads/config'
import type { StorageConfig } from '@/lib/uploads/core/storage-client'
import { getFileMetadataByKey } from '@/lib/uploads/server/metadata'
import { extractStorageKey, inferContextFromKey } from '@/lib/uploads/utils/file-utils'
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
  isLocal?: boolean
): Promise<boolean> {
  try {
    if (context === 'general') {
      return await verifyRegularFileAccess(cloudKey, userId, customConfig, isLocal)
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
 * Origins this app legitimately serves files from: the public base URL, the
 * internal API base URL, and any configured `TRUSTED_ORIGINS`. A document
 * `fileUrl` only authorizes storage access when it is relative (same-origin) or
 * absolute with one of these origins.
 */
function getInternalServeOrigins(): Set<string> {
  const origins = new Set<string>()
  for (const resolve of [getBaseUrl, getInternalApiBaseUrl]) {
    try {
      origins.add(new URL(resolve()).origin)
    } catch {
      // NEXT_PUBLIC_APP_URL unset/invalid — skip; relative fileUrls still resolve.
    }
  }
  for (const origin of parseOriginList(getEnv('TRUSTED_ORIGINS'))) {
    origins.add(origin)
  }
  return origins
}

/**
 * Resolve a knowledge-base document's stored `fileUrl` to the canonical storage
 * key it points at, but only for internal Sim file-serve URLs.
 *
 * Relative paths are same-origin by definition; absolute URLs must match an
 * internal serve origin. A foreign host that embeds `/api/files/serve/` in its
 * path, and `data:` URIs, return `null` so an attacker-planted document can
 * never authorize access to another tenant's storage object.
 */
function resolveInternalKbKey(fileUrl: string | null, allowedOrigins: Set<string>): string | null {
  if (!fileUrl) {
    return null
  }
  let pathname: string
  if (fileUrl.startsWith('/')) {
    pathname = fileUrl
  } else {
    try {
      const parsed = new URL(fileUrl)
      if (!allowedOrigins.has(parsed.origin)) {
        return null
      }
      pathname = parsed.pathname
    } catch {
      return null
    }
  }
  if (!pathname.startsWith('/api/files/serve/')) {
    return null
  }
  const key = extractStorageKey(pathname)
  return key.startsWith('kb/') ? key : null
}

/**
 * Verify access to KB files
 * KB files: kb/filename
 *
 * Access is authorized against the workspace that *owns* the storage object,
 * never against an arbitrary document that merely references it. Ownership is
 * resolved by requiring a document's `fileUrl` to canonically resolve to the
 * exact requested storage key (not a substring/`LIKE` match), and by pinning to
 * the earliest such document — so a later document planted in another workspace
 * cannot authorize the planting user against another tenant's file.
 */
async function verifyKBFileAccess(
  cloudKey: string,
  userId: string,
  customConfig?: StorageConfig
): Promise<boolean> {
  try {
    // LIKE only narrows candidates; ownership is decided below, pinned to the earliest upload.
    const candidateDocuments = await db
      .select({
        workspaceId: knowledgeBase.workspaceId,
        fileUrl: document.fileUrl,
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
      .orderBy(asc(document.uploadedAt))
      .limit(50)

    // Owner is the earliest document whose fileUrl resolves to EXACTLY this key; substring
    // matches and cross-workspace references never establish ownership.
    const allowedOrigins = getInternalServeOrigins()
    const owningDocument = candidateDocuments.find(
      (doc) => resolveInternalKbKey(doc.fileUrl, allowedOrigins) === cloudKey
    )

    if (owningDocument) {
      if (!owningDocument.workspaceId) {
        logger.warn('KB file access denied: owning document has no workspace', {
          userId,
          cloudKey,
        })
        return false
      }

      const permission = await getUserEntityPermissions(
        userId,
        'workspace',
        owningDocument.workspaceId
      )
      if (permission !== null) {
        logger.debug('KB file access granted (owning document lookup)', {
          userId,
          workspaceId: owningDocument.workspaceId,
          cloudKey,
        })
        return true
      }
      logger.warn('KB file access denied: user lacks permission on owning workspace', {
        userId,
        workspaceId: owningDocument.workspaceId,
        cloudKey,
      })
      return false
    }

    // No owning document: metadata only lets us flag the deleted-file case; it never grants access.
    const fileRecord = await getFileMetadataByKey(cloudKey, 'knowledge-base', {
      includeDeleted: true,
    })

    if (fileRecord?.deletedAt) {
      logger.warn('KB file access denied for deleted file metadata', { userId, cloudKey })
      return false
    }

    logger.warn('KB file access denied because no owning KB document matched the file', {
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
