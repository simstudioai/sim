/**
 * Workspace file storage system
 * Files uploaded at workspace level persist indefinitely and are accessible across all workflows
 */

import { db } from '@sim/db'
import { workspaceFiles } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { and, eq, isNull, sql } from 'drizzle-orm'
import {
  checkStorageQuota,
  decrementStorageUsage,
  incrementStorageUsage,
} from '@/lib/billing/storage'
import { normalizeVfsSegment } from '@/lib/copilot/vfs/normalize-segment'
import { generateRestoreName } from '@/lib/core/utils/restore-name'
import { getServePathPrefix } from '@/lib/uploads'
import {
  deleteFile,
  downloadFile,
  hasCloudStorage,
  headObject,
  uploadFile,
} from '@/lib/uploads/core/storage-service'
import { getFileMetadataByKey, insertFileMetadata } from '@/lib/uploads/server/metadata'
import { MAX_WORKSPACE_FILE_SIZE } from '@/lib/uploads/shared/types'
import { getWorkspaceWithOwner } from '@/lib/workspaces/permissions/utils'
import { isUuid, sanitizeFileName } from '@/executor/constants'
import type { UserFile } from '@/executor/types'

const logger = createLogger('WorkspaceFileStorage')

export type WorkspaceFileScope = 'active' | 'archived' | 'all'

export class FileConflictError extends Error {
  readonly code = 'FILE_EXISTS' as const
  constructor(name: string) {
    super(`A file named "${name}" already exists in this workspace`)
  }
}

export interface WorkspaceFileRecord {
  id: string
  workspaceId: string
  name: string
  key: string
  path: string // Full serve path including storage type
  url?: string // Presigned URL for external access (optional, regenerated as needed)
  size: number
  type: string
  uploadedBy: string
  deletedAt?: Date | null
  uploadedAt: Date
  updatedAt: Date
  /** Pass-through to `downloadFile` when not default `workspace` (e.g. chat mothership uploads). */
  storageContext?: 'workspace' | 'mothership'
}

/**
 * Workspace file key pattern: workspace/{workspaceId}/{timestamp}-{random}-{filename}
 */
const WORKSPACE_KEY_PATTERN = /^workspace\/([a-f0-9-]{36})\/(\d+)-([a-z0-9]+)-(.+)$/

/**
 * Check if a key matches workspace file pattern
 * Format: workspace/{workspaceId}/{timestamp}-{random}-{filename}
 */
export function matchesWorkspaceFilePattern(key: string): boolean {
  if (!key || key.startsWith('/api/') || key.startsWith('http')) {
    return false
  }
  return WORKSPACE_KEY_PATTERN.test(key)
}

/**
 * Parse workspace file key to extract workspace ID
 * Format: workspace/{workspaceId}/{timestamp}-{random}-{filename}
 * @returns workspaceId if key matches pattern, null otherwise
 */
export function parseWorkspaceFileKey(key: string): string | null {
  if (!matchesWorkspaceFilePattern(key)) {
    return null
  }

  const match = key.match(WORKSPACE_KEY_PATTERN)
  if (!match) {
    return null
  }

  const workspaceId = match[1]
  return isUuid(workspaceId) ? workspaceId : null
}

/**
 * Generate workspace-scoped storage key with explicit prefix
 * Format: workspace/{workspaceId}/{timestamp}-{random}-{filename}
 */
export function generateWorkspaceFileKey(workspaceId: string, fileName: string): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 9)
  const safeFileName = sanitizeFileName(fileName)
  return `workspace/${workspaceId}/${timestamp}-${random}-${safeFileName}`
}

const MAX_COPY_SUFFIX = 1000
const MAX_UPLOAD_UNIQUE_RETRIES = 8

/**
 * Inserts ` (n)` before the last extension (e.g. `a.pdf` → `a (1).pdf`), or appends for names without.
 */
function withCopySuffix(fileName: string, n: number): string {
  const lastDot = fileName.lastIndexOf('.')
  const hasExtension = lastDot > 0 && lastDot < fileName.length - 1
  if (hasExtension) {
    return `${fileName.slice(0, lastDot)} (${n})${fileName.slice(lastDot)}`
  }
  return `${fileName} (${n})`
}

/**
 * Picks a display name that does not collide with an active workspace file (`original_name`).
 */
async function allocateUniqueWorkspaceFileName(
  workspaceId: string,
  baseName: string
): Promise<string> {
  if (!(await fileExistsInWorkspace(workspaceId, baseName))) {
    return baseName
  }
  for (let n = 1; n <= MAX_COPY_SUFFIX; n++) {
    const candidate = withCopySuffix(baseName, n)
    if (!(await fileExistsInWorkspace(workspaceId, candidate))) {
      return candidate
    }
  }
  throw new FileConflictError(baseName)
}

/**
 * Upload a file to workspace-scoped storage
 */
export async function uploadWorkspaceFile(
  workspaceId: string,
  userId: string,
  fileBuffer: Buffer,
  fileName: string,
  contentType: string
): Promise<UserFile> {
  logger.info(`Uploading workspace file: ${fileName} for workspace ${workspaceId}`)

  const quotaCheck = await checkStorageQuota(userId, fileBuffer.length)

  if (!quotaCheck.allowed) {
    throw new Error(quotaCheck.error || 'Storage limit exceeded')
  }

  let lastError: unknown
  for (let attempt = 0; attempt < MAX_UPLOAD_UNIQUE_RETRIES; attempt++) {
    const uniqueName = await allocateUniqueWorkspaceFileName(workspaceId, fileName)
    const storageKey = generateWorkspaceFileKey(workspaceId, uniqueName)
    let fileId = `wf_${generateShortId()}`

    try {
      logger.info(`Generated storage key: ${storageKey}`)

      const metadata: Record<string, string> = {
        originalName: uniqueName,
        uploadedAt: new Date().toISOString(),
        purpose: 'workspace',
        userId: userId,
        workspaceId: workspaceId,
      }

      const uploadResult = await uploadFile({
        file: fileBuffer,
        fileName: storageKey,
        contentType,
        context: 'workspace',
        preserveKey: true,
        customKey: storageKey,
        metadata,
      })

      logger.info(`Upload returned key: ${uploadResult.key}`)

      const usingCloudStorage = hasCloudStorage()

      if (!usingCloudStorage) {
        const metadataRecord = await insertFileMetadata({
          id: fileId,
          key: uploadResult.key,
          userId,
          workspaceId,
          context: 'workspace',
          originalName: uniqueName,
          contentType,
          size: fileBuffer.length,
        })
        fileId = metadataRecord.id
        logger.info(`Stored metadata in database for local file: ${uploadResult.key}`)
      } else {
        const existing = await getFileMetadataByKey(uploadResult.key, 'workspace')

        if (!existing) {
          logger.warn(`Metadata not found for cloud file ${uploadResult.key}, inserting...`)
          const metadataRecord = await insertFileMetadata({
            id: fileId,
            key: uploadResult.key,
            userId,
            workspaceId,
            context: 'workspace',
            originalName: uniqueName,
            contentType,
            size: fileBuffer.length,
          })
          fileId = metadataRecord.id
        } else {
          fileId = existing.id
          logger.info(`Using existing metadata record for cloud file: ${uploadResult.key}`)
        }
      }

      logger.info(
        `Successfully uploaded workspace file: ${uniqueName} with key: ${uploadResult.key}`
      )

      try {
        await incrementStorageUsage(userId, fileBuffer.length)
      } catch (storageError) {
        logger.error(`Failed to update storage tracking:`, storageError)
      }

      const pathPrefix = getServePathPrefix()
      const serveUrl = `${pathPrefix}${encodeURIComponent(uploadResult.key)}?context=workspace`

      return {
        id: fileId,
        name: uniqueName,
        size: fileBuffer.length,
        type: contentType,
        url: serveUrl,
        key: uploadResult.key,
        context: 'workspace',
      }
    } catch (error) {
      lastError = error
      if (error instanceof FileConflictError) {
        throw error
      }
      if (getPostgresErrorCode(error) === '23505') {
        logger.warn(
          `Unique name conflict on upload (attempt ${attempt + 1}/${MAX_UPLOAD_UNIQUE_RETRIES}), retrying with a new name`
        )
        continue
      }
      logger.error(`Failed to upload workspace file ${fileName}:`, error)
      throw new Error(
        `Failed to upload file: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  logger.error(
    `Failed to upload workspace file after ${MAX_UPLOAD_UNIQUE_RETRIES} attempts`,
    lastError
  )
  throw new FileConflictError(fileName)
}

/**
 * Finalize a workspace file that was uploaded directly to cloud storage
 * (presigned PUT or completed multipart). Verifies the object exists,
 * checks quota, allocates a non-colliding display name, inserts metadata,
 * and increments storage usage.
 *
 * Throws if the object is missing in storage, quota is exceeded, or the
 * caller cannot resolve a unique name within the retry budget.
 */
export interface RegisterUploadedWorkspaceFileResult {
  file: UserFile
  /** True when a new metadata row was inserted; false when an existing row was reused. */
  created: boolean
}

export async function registerUploadedWorkspaceFile(params: {
  workspaceId: string
  userId: string
  key: string
  originalName: string
  contentType: string
}): Promise<RegisterUploadedWorkspaceFileResult> {
  const { workspaceId, userId, key, originalName, contentType } = params

  if (!hasCloudStorage()) {
    throw new Error('Direct-upload registration requires cloud storage')
  }

  if (parseWorkspaceFileKey(key) !== workspaceId) {
    throw new Error('Storage key does not belong to this workspace')
  }

  const head = await headObject(key, 'workspace')
  if (!head) {
    throw new Error('Uploaded object not found in storage')
  }
  const verifiedSize = head.size

  const cleanupOrphan = async (reason: string) => {
    try {
      await deleteFile({ key, context: 'workspace' })
    } catch (deleteError) {
      logger.error(`Failed to clean up orphaned object after ${reason}`, deleteError)
    }
  }

  if (verifiedSize > MAX_WORKSPACE_FILE_SIZE) {
    await cleanupOrphan('size-cap rejection')
    throw new Error(`File size exceeds maximum of ${MAX_WORKSPACE_FILE_SIZE} bytes`)
  }

  /**
   * Existence check precedes the quota guard so a network-dropped retry doesn't
   * double-charge quota or orphan-cleanup an already-registered object.
   */
  const existing = await getFileMetadataByKey(key, 'workspace')

  let fileId = existing?.id ?? ''
  let displayName = existing?.originalName ?? ''
  let created = false

  if (!existing) {
    const quotaCheck = await checkStorageQuota(userId, verifiedSize)
    if (!quotaCheck.allowed) {
      await cleanupOrphan('quota rejection')
      throw new Error(quotaCheck.error || 'Storage limit exceeded')
    }

    let lastInsertError: unknown
    for (let attempt = 0; attempt < MAX_UPLOAD_UNIQUE_RETRIES; attempt++) {
      fileId = `wf_${generateShortId()}`
      displayName = await allocateUniqueWorkspaceFileName(workspaceId, originalName)
      try {
        await insertFileMetadata({
          id: fileId,
          key,
          userId,
          workspaceId,
          context: 'workspace',
          originalName: displayName,
          contentType,
          size: verifiedSize,
        })
        created = true
        lastInsertError = undefined
        break
      } catch (insertError) {
        lastInsertError = insertError
        if (getPostgresErrorCode(insertError) === '23505') {
          logger.warn(
            `Unique name conflict on register (attempt ${attempt + 1}/${MAX_UPLOAD_UNIQUE_RETRIES}), retrying with a new name`
          )
          continue
        }
        break
      }
    }

    if (!created) {
      logger.error(
        'Failed to insert metadata after direct upload; cleaning up storage object',
        lastInsertError
      )
      await cleanupOrphan('metadata insert failure')
      if (getPostgresErrorCode(lastInsertError) === '23505') {
        throw new FileConflictError(originalName)
      }
      throw lastInsertError instanceof Error
        ? lastInsertError
        : new Error('Failed to insert workspace file metadata')
    }

    try {
      await incrementStorageUsage(userId, verifiedSize)
    } catch (storageError) {
      logger.error('Failed to update storage tracking:', storageError)
    }
  } else {
    logger.info(`Using existing metadata record for direct upload: ${key}`)
  }

  const pathPrefix = getServePathPrefix()
  const serveUrl = `${pathPrefix}${encodeURIComponent(key)}?context=workspace`

  return {
    file: {
      id: fileId,
      name: displayName,
      size: verifiedSize,
      type: contentType,
      url: serveUrl,
      key,
      context: 'workspace',
    },
    created,
  }
}

/**
 * Track a file that was already uploaded to workspace S3 as a chat-scoped upload.
 * Links the existing workspaceFiles metadata record (created by the storage service
 * during upload) to the chat by setting chatId and context='mothership'.
 * Falls back to inserting a new record if none exists for the key.
 */
export async function trackChatUpload(
  workspaceId: string,
  userId: string,
  chatId: string,
  s3Key: string,
  fileName: string,
  contentType: string,
  size: number
): Promise<void> {
  const updated = await db
    .update(workspaceFiles)
    .set({ chatId, context: 'mothership' })
    .where(
      and(
        eq(workspaceFiles.key, s3Key),
        eq(workspaceFiles.workspaceId, workspaceId),
        isNull(workspaceFiles.deletedAt)
      )
    )
    .returning({ id: workspaceFiles.id })

  if (updated.length > 0) {
    logger.info(`Linked existing file record to chat: ${fileName} for chat ${chatId}`)
    return
  }

  const fileId = `wf_${generateShortId()}`

  await db.insert(workspaceFiles).values({
    id: fileId,
    key: s3Key,
    userId,
    workspaceId,
    context: 'mothership',
    chatId,
    originalName: fileName,
    contentType,
    size,
  })

  logger.info(`Tracked chat upload: ${fileName} for chat ${chatId}`)
}

/**
 * Check if a file with the same name already exists in workspace
 */
export async function fileExistsInWorkspace(
  workspaceId: string,
  fileName: string
): Promise<boolean> {
  try {
    const existing = await db
      .select()
      .from(workspaceFiles)
      .where(
        and(
          eq(workspaceFiles.workspaceId, workspaceId),
          eq(workspaceFiles.originalName, fileName),
          eq(workspaceFiles.context, 'workspace'),
          isNull(workspaceFiles.deletedAt)
        )
      )
      .limit(1)

    return existing.length > 0
  } catch (error) {
    logger.error(`Failed to check file existence for ${fileName}:`, error)
    return false
  }
}

/**
 * Look up a single active workspace file by its original name.
 * Returns the record if found, or null if no matching file exists.
 * Throws on DB errors so callers can distinguish "not found" from "lookup failed."
 */
export async function getWorkspaceFileByName(
  workspaceId: string,
  fileName: string
): Promise<WorkspaceFileRecord | null> {
  const files = await db
    .select()
    .from(workspaceFiles)
    .where(
      and(
        eq(workspaceFiles.workspaceId, workspaceId),
        eq(workspaceFiles.originalName, fileName),
        eq(workspaceFiles.context, 'workspace'),
        isNull(workspaceFiles.deletedAt)
      )
    )
    .limit(1)

  if (files.length === 0) return null

  const pathPrefix = getServePathPrefix()

  const file = files[0]
  return {
    id: file.id,
    workspaceId: file.workspaceId || workspaceId,
    name: file.originalName,
    key: file.key,
    path: `${pathPrefix}${encodeURIComponent(file.key)}?context=workspace`,
    size: file.size,
    type: file.contentType,
    uploadedBy: file.userId,
    deletedAt: file.deletedAt,
    uploadedAt: file.uploadedAt,
    updatedAt: file.updatedAt,
  }
}

/**
 * List all files for a workspace
 */
export async function listWorkspaceFiles(
  workspaceId: string,
  options?: { scope?: WorkspaceFileScope }
): Promise<WorkspaceFileRecord[]> {
  try {
    const { scope = 'active' } = options ?? {}
    const files = await db
      .select()
      .from(workspaceFiles)
      .where(
        scope === 'all'
          ? and(
              eq(workspaceFiles.workspaceId, workspaceId),
              eq(workspaceFiles.context, 'workspace')
            )
          : scope === 'archived'
            ? and(
                eq(workspaceFiles.workspaceId, workspaceId),
                eq(workspaceFiles.context, 'workspace'),
                sql`${workspaceFiles.deletedAt} IS NOT NULL`
              )
            : and(
                eq(workspaceFiles.workspaceId, workspaceId),
                eq(workspaceFiles.context, 'workspace'),
                isNull(workspaceFiles.deletedAt)
              )
      )
      .orderBy(workspaceFiles.uploadedAt)

    const pathPrefix = getServePathPrefix()

    return files.map((file) => ({
      id: file.id,
      workspaceId: file.workspaceId || workspaceId, // Use query workspaceId as fallback (should never be null for workspace files)
      name: file.originalName,
      key: file.key,
      path: `${pathPrefix}${encodeURIComponent(file.key)}?context=workspace`,
      size: file.size,
      type: file.contentType,
      uploadedBy: file.userId,
      deletedAt: file.deletedAt,
      uploadedAt: file.uploadedAt,
      updatedAt: file.updatedAt,
    }))
  } catch (error) {
    logger.error(`Failed to list workspace files for ${workspaceId}:`, error)
    return []
  }
}

/**
 * Normalize a workspace file reference to either a display name or canonical file ID.
 * Supports raw IDs, `files/{name}`, `files/{name}/content`, `files/{name}/meta.json`,
 * and canonical VFS aliases like `files/by-id/{fileId}/content`.
 */
export function normalizeWorkspaceFileReference(fileReference: string): string {
  const trimmed = fileReference.trim().replace(/^\/+/, '')
  const withoutDeletedPrefix = trimmed.startsWith('recently-deleted/')
    ? trimmed.slice('recently-deleted/'.length)
    : trimmed

  if (withoutDeletedPrefix.startsWith('files/by-id/')) {
    const byIdRef = withoutDeletedPrefix.slice('files/by-id/'.length)
    const match = byIdRef.match(/^([^/]+)(?:\/(?:meta\.json|content))?$/)
    if (match?.[1]) {
      return match[1]
    }
  }

  if (withoutDeletedPrefix.startsWith('by-id/')) {
    const match = withoutDeletedPrefix
      .slice('by-id/'.length)
      .match(/^([^/]+)(?:\/(?:meta\.json|content))?$/)
    if (match?.[1]) {
      return match[1]
    }
  }

  if (withoutDeletedPrefix.startsWith('files/')) {
    const withoutPrefix = withoutDeletedPrefix.slice('files/'.length)
    if (withoutPrefix.endsWith('/meta.json')) {
      return withoutPrefix.slice(0, -'/meta.json'.length)
    }
    if (withoutPrefix.endsWith('/content')) {
      return withoutPrefix.slice(0, -'/content'.length)
    }
    return withoutPrefix
  }

  return withoutDeletedPrefix
}

/**
 * Canonical sandbox mount path for an existing workspace file.
 */
export function getSandboxWorkspaceFilePath(
  file: Pick<WorkspaceFileRecord, 'id' | 'name'>
): string {
  return `/home/user/files/${file.id}/${file.name}`
}

/**
 * Find a workspace file record in an existing list from either its id or a VFS/name reference.
 * For copilot `open_resource` and the resource panel, use {@link getWorkspaceFile} with a UUID only.
 */
export function findWorkspaceFileRecord(
  files: WorkspaceFileRecord[],
  fileReference: string
): WorkspaceFileRecord | null {
  const exactIdMatch = files.find((file) => file.id === fileReference)
  if (exactIdMatch) {
    return exactIdMatch
  }

  const normalizedReference = normalizeWorkspaceFileReference(fileReference)
  const normalizedIdMatch = files.find((file) => file.id === normalizedReference)
  if (normalizedIdMatch) {
    return normalizedIdMatch
  }

  const segmentKey = normalizeVfsSegment(normalizedReference)
  return files.find((file) => normalizeVfsSegment(file.name) === segmentKey) ?? null
}

/**
 * Resolve a workspace file record from either its id or a VFS/name reference.
 */
export async function resolveWorkspaceFileReference(
  workspaceId: string,
  fileReference: string
): Promise<WorkspaceFileRecord | null> {
  const files = await listWorkspaceFiles(workspaceId)
  return findWorkspaceFileRecord(files, fileReference)
}

/**
 * Get a specific workspace file
 */
export async function getWorkspaceFile(
  workspaceId: string,
  fileId: string,
  options?: { includeDeleted?: boolean }
): Promise<WorkspaceFileRecord | null> {
  try {
    const { includeDeleted = false } = options ?? {}
    const files = await db
      .select()
      .from(workspaceFiles)
      .where(
        includeDeleted
          ? and(
              eq(workspaceFiles.id, fileId),
              eq(workspaceFiles.workspaceId, workspaceId),
              eq(workspaceFiles.context, 'workspace')
            )
          : and(
              eq(workspaceFiles.id, fileId),
              eq(workspaceFiles.workspaceId, workspaceId),
              eq(workspaceFiles.context, 'workspace'),
              isNull(workspaceFiles.deletedAt)
            )
      )
      .limit(1)

    if (files.length === 0) return null

    const pathPrefix = getServePathPrefix()

    const file = files[0]
    return {
      id: file.id,
      workspaceId: file.workspaceId || workspaceId, // Use query workspaceId as fallback (should never be null for workspace files)
      name: file.originalName,
      key: file.key,
      path: `${pathPrefix}${encodeURIComponent(file.key)}?context=workspace`,
      size: file.size,
      type: file.contentType,
      uploadedBy: file.userId,
      deletedAt: file.deletedAt,
      uploadedAt: file.uploadedAt,
      updatedAt: file.updatedAt,
    }
  } catch (error) {
    logger.error(`Failed to get workspace file ${fileId}:`, error)
    return null
  }
}

/**
 * Download workspace file content
 */
export async function fetchWorkspaceFileBuffer(fileRecord: WorkspaceFileRecord): Promise<Buffer> {
  logger.info(`Downloading workspace file: ${fileRecord.name}`)

  try {
    const buffer = await downloadFile({
      key: fileRecord.key,
      context: fileRecord.storageContext ?? 'workspace',
    })
    logger.info(
      `Successfully downloaded workspace file: ${fileRecord.name} (${buffer.length} bytes)`
    )
    return buffer
  } catch (error) {
    logger.error(`Failed to download workspace file ${fileRecord.name}:`, error)
    throw new Error(
      `Failed to download file: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

/**
 * Update a workspace file's content (re-uploads to same storage key)
 */
export async function updateWorkspaceFileContent(
  workspaceId: string,
  fileId: string,
  userId: string,
  content: Buffer,
  contentType?: string
): Promise<WorkspaceFileRecord> {
  logger.info(`Updating workspace file content: ${fileId} for workspace ${workspaceId}`)

  const fileRecord = await getWorkspaceFile(workspaceId, fileId)
  if (!fileRecord) {
    throw new Error('File not found')
  }

  const sizeDiff = content.length - fileRecord.size
  if (sizeDiff > 0) {
    const quotaCheck = await checkStorageQuota(userId, sizeDiff)
    if (!quotaCheck.allowed) {
      throw new Error(quotaCheck.error || 'Storage limit exceeded')
    }
  }

  const nextContentType = contentType || fileRecord.type

  try {
    const metadata: Record<string, string> = {
      originalName: fileRecord.name,
      uploadedAt: new Date().toISOString(),
      purpose: 'workspace',
      userId,
      workspaceId,
    }

    await uploadFile({
      file: content,
      fileName: fileRecord.key,
      contentType: nextContentType,
      context: 'workspace',
      preserveKey: true,
      customKey: fileRecord.key,
      metadata,
    })

    await db
      .update(workspaceFiles)
      .set({ size: content.length, contentType: nextContentType, updatedAt: new Date() })
      .where(
        and(
          eq(workspaceFiles.id, fileId),
          eq(workspaceFiles.workspaceId, workspaceId),
          eq(workspaceFiles.context, 'workspace')
        )
      )

    if (sizeDiff !== 0) {
      try {
        if (sizeDiff > 0) {
          await incrementStorageUsage(userId, sizeDiff)
        } else {
          await decrementStorageUsage(userId, Math.abs(sizeDiff))
        }
      } catch (storageError) {
        logger.error(`Failed to update storage tracking:`, storageError)
      }
    }

    logger.info(`Successfully updated workspace file content: ${fileRecord.name}`)

    return {
      ...fileRecord,
      size: content.length,
      type: nextContentType,
    }
  } catch (error) {
    logger.error(`Failed to update workspace file content ${fileId}:`, error)
    throw new Error(
      `Failed to update file content: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

/**
 * Rename a workspace file (updates the display name in the database)
 */
export async function renameWorkspaceFile(
  workspaceId: string,
  fileId: string,
  newName: string
): Promise<WorkspaceFileRecord> {
  logger.info(`Renaming workspace file: ${fileId} to "${newName}" in workspace ${workspaceId}`)

  const trimmedName = newName.trim()
  if (!trimmedName) {
    throw new Error('File name cannot be empty')
  }

  const fileRecord = await getWorkspaceFile(workspaceId, fileId)
  if (!fileRecord) {
    throw new Error('File not found')
  }

  if (fileRecord.name === trimmedName) {
    return fileRecord
  }

  const exists = await fileExistsInWorkspace(workspaceId, trimmedName)
  if (exists) {
    throw new FileConflictError(trimmedName)
  }

  let updated: { id: string }[]
  try {
    updated = await db
      .update(workspaceFiles)
      .set({ originalName: trimmedName, updatedAt: new Date() })
      .where(
        and(
          eq(workspaceFiles.id, fileId),
          eq(workspaceFiles.workspaceId, workspaceId),
          eq(workspaceFiles.context, 'workspace')
        )
      )
      .returning({ id: workspaceFiles.id })
  } catch (error: unknown) {
    if (getPostgresErrorCode(error) === '23505') {
      throw new FileConflictError(trimmedName)
    }
    throw error
  }

  if (updated.length === 0) {
    throw new Error('File not found or could not be renamed')
  }

  logger.info(`Successfully renamed workspace file ${fileId} to "${trimmedName}"`)

  return {
    ...fileRecord,
    name: trimmedName,
  }
}

/**
 * Soft delete a workspace file.
 */
export async function deleteWorkspaceFile(workspaceId: string, fileId: string): Promise<void> {
  logger.info(`Deleting workspace file: ${fileId}`)

  try {
    const fileRecord = await getWorkspaceFile(workspaceId, fileId)
    if (!fileRecord) {
      throw new Error('File not found')
    }

    await db
      .update(workspaceFiles)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(workspaceFiles.id, fileId),
          eq(workspaceFiles.workspaceId, workspaceId),
          eq(workspaceFiles.context, 'workspace'),
          isNull(workspaceFiles.deletedAt)
        )
      )

    logger.info(`Successfully archived workspace file: ${fileRecord.name}`)
  } catch (error) {
    logger.error(`Failed to delete workspace file ${fileId}:`, error)
    throw new Error(
      `Failed to delete file: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

/**
 * Restore a soft-deleted workspace file.
 */
export async function restoreWorkspaceFile(workspaceId: string, fileId: string): Promise<void> {
  logger.info(`Restoring workspace file: ${fileId}`)

  const fileRecord = await getWorkspaceFile(workspaceId, fileId, { includeDeleted: true })
  if (!fileRecord) {
    throw new Error('File not found')
  }

  if (!fileRecord.deletedAt) {
    throw new Error('File is not archived')
  }

  const ws = await getWorkspaceWithOwner(workspaceId)
  if (!ws || ws.archivedAt) {
    throw new Error('Cannot restore file into an archived workspace')
  }

  /**
   * A concurrent upload/rename can claim the chosen name after `generateRestoreName`'s check (MVCC).
   * Retries pick a new random suffix; 23505 maps to {@link FileConflictError} after exhaustion.
   */
  const maxUniqueViolationRetries = 8
  let attemptedRestoreName = ''

  for (let attempt = 0; attempt < maxUniqueViolationRetries; attempt++) {
    attemptedRestoreName = ''
    try {
      const newName = await generateRestoreName(
        fileRecord.name,
        (candidate) => fileExistsInWorkspace(workspaceId, candidate),
        { hasExtension: true }
      )
      attemptedRestoreName = newName

      await db
        .update(workspaceFiles)
        .set({ deletedAt: null, originalName: newName, updatedAt: new Date() })
        .where(
          and(
            eq(workspaceFiles.id, fileId),
            eq(workspaceFiles.workspaceId, workspaceId),
            eq(workspaceFiles.context, 'workspace')
          )
        )

      logger.info(`Successfully restored workspace file: ${newName}`)
      return
    } catch (error: unknown) {
      if (getPostgresErrorCode(error) !== '23505') {
        throw error
      }
      if (attempt === maxUniqueViolationRetries - 1) {
        throw new FileConflictError(attemptedRestoreName || fileRecord.name)
      }
    }
  }
}
