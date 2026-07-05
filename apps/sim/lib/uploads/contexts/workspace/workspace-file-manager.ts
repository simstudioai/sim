/**
 * Workspace file storage system
 * Files uploaded at workspace level persist indefinitely and are accessible across all workflows
 */

import { randomBytes } from 'crypto'
import { db } from '@sim/db'
import { workspaceFiles } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage, getPostgresConstraintName, getPostgresErrorCode } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { ShareRecord } from '@/lib/api/contracts/public-shares'
import {
  checkStorageQuota,
  decrementStorageUsage,
  incrementStorageUsage,
} from '@/lib/billing/storage'
import { normalizeVfsSegment } from '@/lib/copilot/vfs/normalize-segment'
import { canonicalWorkspaceFilePath, decodeVfsPathSegments } from '@/lib/copilot/vfs/path-utils'
import { resolveWorkflowAliasForWorkspace } from '@/lib/copilot/vfs/workflow-alias-resolver'
import { isReservedWorkflowAliasBackingDisplayPath } from '@/lib/copilot/vfs/workflow-aliases'
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
import type { WorkspaceFileFolderRecord } from './workspace-file-folder-manager'
import {
  assertWorkspaceFileFolderTarget,
  buildWorkspaceFileFolderPathMap,
  fileNameExistsInWorkspaceFolder,
  findWorkspaceFileFolderIdByPath,
  getWorkspaceFileFolderPath,
  listWorkspaceFileFolders,
  normalizeWorkspaceFileItemName,
} from './workspace-file-folder-manager'

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
  folderId?: string | null
  folderPath?: string | null
  deletedAt?: Date | null
  uploadedAt: Date
  updatedAt: Date
  /** Pass-through to `downloadFile` when not default `workspace` (e.g. chat mothership uploads, agent outputs). */
  storageContext?: 'workspace' | 'mothership' | 'output'
  /** Public share state, attached at the API boundary. `null` when never shared. */
  share?: ShareRecord | null
}

interface ListWorkspaceFilesOptions {
  scope?: WorkspaceFileScope
  folders?: WorkspaceFileFolderRecord[]
  hydrateFolderPaths?: boolean
  includeReservedSystemFiles?: boolean
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
  const random = randomBytes(8).toString('hex')
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
export async function allocateUniqueWorkspaceFileName(
  workspaceId: string,
  baseName: string,
  folderId?: string | null
): Promise<string> {
  if (!(await fileExistsInWorkspace(workspaceId, baseName, folderId))) {
    return baseName
  }
  for (let n = 1; n <= MAX_COPY_SUFFIX; n++) {
    const candidate = withCopySuffix(baseName, n)
    if (!(await fileExistsInWorkspace(workspaceId, candidate, folderId))) {
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
  contentType: string,
  options?: { folderId?: string | null; exactName?: boolean }
): Promise<UserFile> {
  logger.info(`Uploading workspace file: ${fileName} for workspace ${workspaceId}`)

  const folderId = await assertWorkspaceFileFolderTarget(workspaceId, options?.folderId)
  const normalizedFileName = normalizeWorkspaceFileItemName(fileName, 'File')
  const exactName = options?.exactName ?? false
  const quotaCheck = await checkStorageQuota(userId, fileBuffer.length)

  if (!quotaCheck.allowed) {
    throw new Error(quotaCheck.error || 'Storage limit exceeded')
  }

  let lastError: unknown
  const maxAttempts = exactName ? 1 : MAX_UPLOAD_UNIQUE_RETRIES
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const uniqueName = exactName
      ? normalizedFileName
      : await allocateUniqueWorkspaceFileName(workspaceId, normalizedFileName, folderId)
    if (exactName && (await fileExistsInWorkspace(workspaceId, uniqueName, folderId))) {
      throw new FileConflictError(uniqueName)
    }
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
        ...(folderId ? { folderId } : {}),
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
          folderId,
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
            folderId,
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
        await incrementStorageUsage(userId, fileBuffer.length, workspaceId)
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
        if (exactName) {
          throw new FileConflictError(normalizedFileName)
        }
        logger.warn(
          `Unique name conflict on upload (attempt ${attempt + 1}/${MAX_UPLOAD_UNIQUE_RETRIES}), retrying with a new name`
        )
        continue
      }
      logger.error(`Failed to upload workspace file ${fileName}:`, error)
      throw new Error(`Failed to upload file: ${getErrorMessage(error, 'Unknown error')}`)
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
  folderId?: string | null
}): Promise<RegisterUploadedWorkspaceFileResult> {
  const { workspaceId, userId, key, originalName, contentType } = params
  const folderId = await assertWorkspaceFileFolderTarget(workspaceId, params.folderId)
  const normalizedOriginalName = normalizeWorkspaceFileItemName(originalName, 'File')

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
      displayName = await allocateUniqueWorkspaceFileName(
        workspaceId,
        normalizedOriginalName,
        folderId
      )
      try {
        await insertFileMetadata({
          id: fileId,
          key,
          userId,
          workspaceId,
          folderId,
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
        throw new FileConflictError(normalizedOriginalName)
      }
      throw lastInsertError instanceof Error
        ? lastInsertError
        : new Error('Failed to insert workspace file metadata')
    }

    try {
      await incrementStorageUsage(userId, verifiedSize, workspaceId)
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
 * Like `withCopySuffix` but with `n=1` meaning "no suffix" — used by retry loops where
 * the first attempt should try the original name (`image.png`, `image (2).png`, ...).
 * Exported for tests.
 */
export function suffixedName(name: string, n: number): string {
  return n <= 1 ? name : withCopySuffix(name, n)
}

const MAX_CHAT_DISPLAY_NAME_RETRIES = 1000

/** Postgres constraint name for the partial unique index on `(chat_id, display_name)`. */
export const CHAT_DISPLAY_NAME_INDEX = 'workspace_files_chat_display_name_unique'

/**
 * Track a file that was already uploaded to workspace S3 as a chat-scoped upload.
 * Links the existing workspaceFiles metadata record (created by the storage service
 * during upload) to the chat by setting chatId and context='mothership'.
 * Falls back to inserting a new record if none exists for the key.
 *
 * Allocates a collision-free `displayName` (the partial unique index on
 * (chat_id, display_name) WHERE context='mothership' enforces this) and returns it
 * so callers can surface the same name to the model in the VFS read hint.
 */
export async function trackChatUpload(
  workspaceId: string,
  userId: string,
  chatId: string,
  s3Key: string,
  fileName: string,
  contentType: string,
  size: number,
  messageId?: string
): Promise<{ displayName: string }> {
  for (let n = 1; n <= MAX_CHAT_DISPLAY_NAME_RETRIES; n++) {
    const candidate = suffixedName(fileName, n)
    try {
      const updated = await db
        .update(workspaceFiles)
        .set({
          chatId,
          messageId: messageId ?? null,
          context: 'mothership',
          displayName: candidate,
        })
        .where(
          and(
            eq(workspaceFiles.key, s3Key),
            eq(workspaceFiles.workspaceId, workspaceId),
            isNull(workspaceFiles.deletedAt)
          )
        )
        .returning({ id: workspaceFiles.id })

      if (updated.length > 0) {
        logger.info(
          `Linked existing file record to chat: ${fileName} (display: ${candidate}) for chat ${chatId}`
        )
        return { displayName: candidate }
      }

      const fileId = `wf_${generateShortId()}`

      await db.insert(workspaceFiles).values({
        id: fileId,
        key: s3Key,
        userId,
        workspaceId,
        context: 'mothership',
        chatId,
        messageId: messageId ?? null,
        originalName: fileName,
        displayName: candidate,
        contentType,
        size,
      })

      logger.info(`Tracked chat upload: ${fileName} (display: ${candidate}) for chat ${chatId}`)
      return { displayName: candidate }
    } catch (error) {
      // Other 23505s (e.g. active-key collision from a racing same-s3Key insert) signal
      // a different invariant — retrying would silently rename a row another caller owns.
      if (
        getPostgresErrorCode(error) === '23505' &&
        getPostgresConstraintName(error) === CHAT_DISPLAY_NAME_INDEX
      ) {
        logger.warn(
          `Chat upload displayName collision on attempt ${n} for "${candidate}" in chat ${chatId}, retrying with suffix`
        )
        continue
      }
      throw error
    }
  }

  throw new FileConflictError(fileName)
}

const MAX_CHAT_OUTPUT_NAME_RETRIES = 1000

/** Postgres constraint name for the partial unique index on `(chat_id, display_name)` for outputs. */
export const CHAT_OUTPUT_DISPLAY_NAME_INDEX = 'workspace_files_chat_output_display_name_unique'

/**
 * The chat's existing active output display names, read once so suffix
 * allocation picks a free name in memory instead of one SELECT per candidate.
 * The `workspace_files_chat_output_display_name_unique` partial index is the
 * real guarantee — a concurrent racer, or a soft-deleted tombstone this
 * active-rows read can't see (the index spans the row's whole lifetime),
 * surfaces as a 23505 that {@link uploadChatOutput} retries past.
 */
async function listChatOutputNames(chatId: string): Promise<Set<string>> {
  const rows = await db
    .select({ displayName: workspaceFiles.displayName })
    .from(workspaceFiles)
    .where(
      and(
        eq(workspaceFiles.chatId, chatId),
        eq(workspaceFiles.context, 'output'),
        isNull(workspaceFiles.deletedAt)
      )
    )
  const names = new Set<string>()
  for (const row of rows) {
    if (row.displayName) names.add(row.displayName)
  }
  return names
}

/**
 * Persist an agent-generated one-off file as a chat-scoped output.
 *
 * Mirrors {@link trackChatUpload} (the user-upload equivalent) but for files the
 * AGENT generates: same workspace storage bucket and `workspace_files` table, but
 * tagged `context='output'` with the owning `chatId`. The copilot VFS exposes these
 * under `outputs/<displayName>`; they never appear in the Files UI and are deleted
 * with the chat (see CHAT_SCOPED_CONTEXTS in chat-cleanup). Outputs are write-once —
 * there is no update path; to edit one the agent materializes it to `files/` first.
 */
export async function uploadChatOutput(args: {
  workspaceId: string
  userId: string
  chatId: string
  fileBuffer: Buffer
  fileName: string
  contentType: string
  /**
   * User message id of the turn that generated this output. Drives the branch
   * fork's timeline cut (an output travels with a fork iff the message that
   * requested it is kept), like `message_id` on uploads. NULL rows predate the
   * stamping and are copied into every fork of their chat.
   */
  messageId?: string
}): Promise<UserFile> {
  const { workspaceId, userId, chatId, fileBuffer, fileName, contentType, messageId } = args
  logger.info(`Uploading chat output file: ${fileName} for chat ${chatId}`)

  const normalizedFileName = normalizeWorkspaceFileItemName(fileName, 'File')

  const quotaCheck = await checkStorageQuota(userId, fileBuffer.length)
  if (!quotaCheck.allowed) {
    throw new Error(quotaCheck.error || 'Storage limit exceeded')
  }

  // The key has its own timestamp+random component, so it stays unique (and
  // valid) if a name collision below lands the row on a suffixed display name.
  const storageKey = generateWorkspaceFileKey(workspaceId, normalizedFileName)
  const fileId = `wf_${generateShortId()}`
  let blobUploaded = false
  let displayName: string | null = null

  try {
    // NOTE: do NOT pass `metadata` here. When `uploadFile` receives `metadata` it
    // ALSO inserts a `workspace_files` row (via insertFileMetadataHelper) keyed on
    // the storage key. We do our own chat-scoped insert below (with chat_id +
    // display_name + context 'output'), so passing metadata would produce a second
    // row with the same key and fail the `workspace_files_key_active_unique` index
    // (duplicate key, 23505). Upload the bytes only; this insert is the sole DB row.
    const uploadResult = await uploadFile({
      file: fileBuffer,
      fileName: storageKey,
      contentType,
      context: 'output',
      preserveKey: true,
      customKey: storageKey,
    })
    blobUploaded = true

    // One read of the chat's existing names, then pick the first free suffix
    // in memory. The partial unique index arbitrates what the read can't see
    // (concurrent racers, soft-deleted tombstones); the loser advances to the
    // next ` (n)` suffix — same retry contract as trackChatUpload.
    const existingNames = await listChatOutputNames(chatId)
    for (let n = 1; n <= MAX_CHAT_OUTPUT_NAME_RETRIES; n++) {
      const candidate = suffixedName(normalizedFileName, n)
      if (existingNames.has(candidate)) {
        continue
      }
      try {
        await db.insert(workspaceFiles).values({
          id: fileId,
          key: uploadResult.key,
          userId,
          workspaceId,
          context: 'output',
          chatId,
          messageId: messageId ?? null,
          originalName: candidate,
          displayName: candidate,
          contentType,
          size: fileBuffer.length,
        })
        displayName = candidate
        break
      } catch (error) {
        if (
          getPostgresErrorCode(error) === '23505' &&
          getPostgresConstraintName(error) === CHAT_OUTPUT_DISPLAY_NAME_INDEX
        ) {
          logger.warn(
            `Chat output displayName collision on attempt ${n} for "${candidate}" in chat ${chatId}, retrying with suffix`
          )
          continue
        }
        throw error
      }
    }
    if (!displayName) {
      throw new FileConflictError(normalizedFileName)
    }

    try {
      await incrementStorageUsage(userId, fileBuffer.length, workspaceId)
    } catch (storageError) {
      logger.error('Failed to update storage tracking:', storageError)
    }

    const pathPrefix = getServePathPrefix()
    const serveUrl = `${pathPrefix}${encodeURIComponent(uploadResult.key)}?context=output`

    logger.info(`Tracked chat output: ${displayName} for chat ${chatId}`)

    return {
      id: fileId,
      name: displayName,
      size: fileBuffer.length,
      type: contentType,
      url: serveUrl,
      key: uploadResult.key,
      context: 'output',
    }
  } catch (error) {
    // When the insert never landed, no row references the just-uploaded blob —
    // delete it (best-effort) so it can't orphan in the bucket forever (chat
    // cleanup iterates DB rows and would never find it).
    if (blobUploaded && !displayName) {
      await deleteFile({ key: storageKey, context: 'output' }).catch((cleanupError) => {
        logger.warn('Failed to clean up orphaned chat output blob', {
          storageKey,
          error: getErrorMessage(cleanupError, 'Unknown error'),
        })
      })
    }
    if (error instanceof FileConflictError) {
      throw error
    }
    logger.error(`Failed to upload chat output file ${fileName}:`, error)
    throw new Error(`Failed to upload output file: ${getErrorMessage(error, 'Unknown error')}`)
  }
}

/**
 * Check if a file with the same name already exists in workspace
 */
export async function fileExistsInWorkspace(
  workspaceId: string,
  fileName: string,
  folderId?: string | null
): Promise<boolean> {
  try {
    return await fileNameExistsInWorkspaceFolder(workspaceId, fileName, folderId)
  } catch (error) {
    logger.error(`Failed to check file existence for ${fileName}:`, error)
    return false
  }
}

function mapWorkspaceFileRecord(
  file: typeof workspaceFiles.$inferSelect,
  workspaceId: string,
  folderPaths: Map<string, string>
): WorkspaceFileRecord {
  const pathPrefix = getServePathPrefix()
  // Listings only ever map context='workspace' rows, but the by-id preview
  // path (getPreviewableWorkspaceFile) also maps chat-scoped 'output' rows —
  // their serve URL and storageContext must carry the row's real context or
  // downstream download/serve resolves against the wrong storage context.
  const storageContext = (file.context ?? 'workspace') as WorkspaceFileRecord['storageContext']
  return {
    id: file.id,
    workspaceId: file.workspaceId || workspaceId,
    name: file.originalName,
    key: file.key,
    path: `${pathPrefix}${encodeURIComponent(file.key)}?context=${storageContext}`,
    size: file.size,
    type: file.contentType,
    uploadedBy: file.userId,
    folderId: file.folderId,
    folderPath: file.folderId ? (folderPaths.get(file.folderId) ?? null) : null,
    deletedAt: file.deletedAt,
    uploadedAt: file.uploadedAt,
    updatedAt: file.updatedAt,
    storageContext,
  }
}

async function mapSingleWorkspaceFileRecord(
  file: typeof workspaceFiles.$inferSelect,
  workspaceId: string
): Promise<WorkspaceFileRecord> {
  if (!file.folderId) {
    return mapWorkspaceFileRecord(file, workspaceId, new Map())
  }

  const folderPath = await getWorkspaceFileFolderPath(workspaceId, file.folderId, {
    includeDeleted: true,
  })
  return mapWorkspaceFileRecord(
    file,
    workspaceId,
    folderPath ? new Map([[file.folderId, folderPath]]) : new Map()
  )
}

/**
 * Look up a single active workspace file by its original name.
 * Returns the record if found, or null if no matching file exists.
 * Throws on DB errors so callers can distinguish "not found" from "lookup failed."
 */
export async function getWorkspaceFileByName(
  workspaceId: string,
  fileName: string,
  options?: { folderId?: string | null }
): Promise<WorkspaceFileRecord | null> {
  const folderId = options?.folderId ?? null
  const files = await db
    .select()
    .from(workspaceFiles)
    .where(
      and(
        eq(workspaceFiles.workspaceId, workspaceId),
        eq(workspaceFiles.originalName, fileName),
        eq(workspaceFiles.context, 'workspace'),
        folderId ? eq(workspaceFiles.folderId, folderId) : isNull(workspaceFiles.folderId),
        isNull(workspaceFiles.deletedAt)
      )
    )
    .limit(1)

  if (files.length === 0) return null

  return mapSingleWorkspaceFileRecord(files[0], workspaceId)
}

/**
 * List all files for a workspace
 */
export async function listWorkspaceFiles(
  workspaceId: string,
  options?: ListWorkspaceFilesOptions
): Promise<WorkspaceFileRecord[]> {
  try {
    const {
      scope = 'active',
      hydrateFolderPaths = true,
      includeReservedSystemFiles = false,
    } = options ?? {}
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

    const needsFolderPaths =
      files.some((file) => file.folderId) && (hydrateFolderPaths || !includeReservedSystemFiles)
    const folders = needsFolderPaths
      ? includeReservedSystemFiles && options?.folders
        ? options.folders
        : await listWorkspaceFileFolders(workspaceId, {
            scope: 'all',
            includeReservedSystemFolders: true,
          })
      : []
    const folderPaths = needsFolderPaths ? buildWorkspaceFileFolderPathMap(folders) : new Map()

    return files
      .map((file) => mapWorkspaceFileRecord(file, workspaceId, folderPaths))
      .filter((file) => {
        if (includeReservedSystemFiles) return true
        return !isReservedWorkflowAliasBackingDisplayPath(file.folderPath)
      })
  } catch (error) {
    logger.error(`Failed to list workspace files for ${workspaceId}:`, error)
    return []
  }
}

/**
 * Normalize a workspace file reference to either a display name or canonical file ID.
 * Supports raw IDs, `files/{name}`, `files/{name}/content`, and `files/{name}/meta.json`.
 * Files are addressed by their sanitized canonical path; id-based VFS paths are not supported.
 */
export function normalizeWorkspaceFileReference(fileReference: string): string {
  const trimmed = fileReference.trim().replace(/^\/+/, '')
  const withoutDeletedPrefix = trimmed.startsWith('recently-deleted/')
    ? trimmed.slice('recently-deleted/'.length)
    : trimmed

  if (withoutDeletedPrefix.startsWith('files/')) {
    const withoutPrefix = withoutDeletedPrefix.slice('files/'.length)
    if (withoutPrefix.endsWith('/meta.json')) {
      return decodeVfsPathSegments(withoutPrefix.slice(0, -'/meta.json'.length)).join('/')
    }
    if (withoutPrefix.endsWith('/content')) {
      return decodeVfsPathSegments(withoutPrefix.slice(0, -'/content'.length)).join('/')
    }
    return decodeVfsPathSegments(withoutPrefix).join('/')
  }

  return decodeVfsPathSegments(withoutDeletedPrefix).join('/')
}

/**
 * Canonical sandbox mount path for an existing workspace file.
 */
export function getSandboxWorkspaceFilePath(
  file: Pick<WorkspaceFileRecord, 'folderPath' | 'name'>
): string {
  return `/home/user/${canonicalWorkspaceFilePath({ folderPath: file.folderPath, name: file.name })}`
}

/**
 * Find a workspace file record in an existing list from either its id or a VFS/name reference.
 * For copilot `open_resource` and the resource panel, use {@link getWorkspaceFile} with the file id.
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

  const segmentKey = normalizedReference
    .split('/')
    .map((segment) => normalizeVfsSegment(segment))
    .join('/')
  const normalizedPathMatch = files.find((file) => {
    const folderPath = file.folderPath
      ?.split('/')
      .map((segment) => normalizeVfsSegment(segment))
      .join('/')
    const fullPath = folderPath
      ? `${folderPath}/${normalizeVfsSegment(file.name)}`
      : normalizeVfsSegment(file.name)
    return fullPath === segmentKey
  })
  if (normalizedPathMatch) return normalizedPathMatch

  return files.find((file) => normalizeVfsSegment(file.name) === segmentKey) ?? null
}

async function getWorkspaceFileByExactReference(
  workspaceId: string,
  fileReference: string
): Promise<WorkspaceFileRecord | null> {
  const segments = fileReference
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)

  if (segments.length === 0) return null
  if (segments.length === 1) {
    return getWorkspaceFileByName(workspaceId, segments[0], { folderId: null })
  }

  const folderId = await findWorkspaceFileFolderIdByPath(workspaceId, segments.slice(0, -1), {
    includeReservedSystemFolders: true,
  })
  return folderId ? getWorkspaceFileByName(workspaceId, segments.at(-1) ?? '', { folderId }) : null
}

/**
 * Resolve a workspace file record from either its id or a VFS/name reference.
 */
export async function resolveWorkspaceFileReference(
  workspaceId: string,
  fileReference: string
): Promise<WorkspaceFileRecord | null> {
  const alias = await resolveWorkflowAliasForWorkspace({ workspaceId, path: fileReference })
  if (alias) {
    if (alias.kind === 'plans_dir') return null
    return resolveWorkspaceFileReference(workspaceId, alias.backingPath)
  }

  const normalizedReference = normalizeWorkspaceFileReference(fileReference)
  if (normalizedReference.startsWith('wf_')) {
    const file = await getWorkspaceFile(workspaceId, normalizedReference)
    if (file) return file
  }

  const exactReferenceFile = await getWorkspaceFileByExactReference(
    workspaceId,
    normalizedReference
  )
  if (exactReferenceFile) return exactReferenceFile

  const files = await listWorkspaceFiles(workspaceId, { includeReservedSystemFiles: true })
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

    return mapSingleWorkspaceFileRecord(files[0], workspaceId)
  } catch (error) {
    logger.error(`Failed to get workspace file ${fileId}:`, error)
    return null
  }
}

/**
 * Fetch a single file record by id for PREVIEW, including the chat-scoped `output`
 * context (agent-generated outputs) that never appears in the workspace Files list.
 * Returns the same shape as {@link listWorkspaceFiles} so the resource panel can
 * render an output that {@link getWorkspaceFile}/list would miss. Workspace
 * membership is the caller's responsibility; chat-output OWNERSHIP is enforced
 * here — `output` rows belong to a private chat, so only the owning chat's user
 * may resolve them (non-owners get null, indistinguishable from a missing id).
 *
 * `mothership` chat uploads are intentionally not included here — surfacing uploads
 * through this preview path is out of scope for the outputs feature (see
 * outputs-vfs-followups.md #2/#7) and can be added later if wanted.
 */
export async function getPreviewableWorkspaceFile(
  workspaceId: string,
  fileId: string,
  requestingUserId: string
): Promise<WorkspaceFileRecord | null> {
  try {
    const [file] = await db
      .select()
      .from(workspaceFiles)
      .where(
        and(
          eq(workspaceFiles.id, fileId),
          eq(workspaceFiles.workspaceId, workspaceId),
          inArray(workspaceFiles.context, ['workspace', 'output']),
          isNull(workspaceFiles.deletedAt)
        )
      )
      .limit(1)

    if (!file) return null
    if (file.context === 'output' && file.userId !== requestingUserId) {
      logger.warn('Chat output preview denied: caller is not the owning chat user', {
        fileId,
        workspaceId,
        requestingUserId,
      })
      return null
    }
    return mapSingleWorkspaceFileRecord(file, workspaceId)
  } catch (error) {
    logger.error(`Failed to get previewable workspace file ${fileId}:`, error)
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
    throw new Error(`Failed to download file: ${getErrorMessage(error, 'Unknown error')}`)
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
      ...(fileRecord.folderId ? { folderId: fileRecord.folderId } : {}),
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
          await incrementStorageUsage(userId, sizeDiff, workspaceId)
        } else {
          await decrementStorageUsage(userId, Math.abs(sizeDiff), workspaceId)
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
    throw new Error(`Failed to update file content: ${getErrorMessage(error, 'Unknown error')}`)
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
  const normalizedName = normalizeWorkspaceFileItemName(trimmedName, 'File')

  const fileRecord = await getWorkspaceFile(workspaceId, fileId)
  if (!fileRecord) {
    throw new Error('File not found')
  }

  if (fileRecord.name === normalizedName) {
    return fileRecord
  }

  const exists = await fileExistsInWorkspace(workspaceId, normalizedName, fileRecord.folderId)
  if (exists) {
    throw new FileConflictError(normalizedName)
  }

  let updated: { id: string }[]
  try {
    updated = await db
      .update(workspaceFiles)
      .set({ originalName: normalizedName, updatedAt: new Date() })
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
      throw new FileConflictError(normalizedName)
    }
    throw error
  }

  if (updated.length === 0) {
    throw new Error('File not found or could not be renamed')
  }

  logger.info(`Successfully renamed workspace file ${fileId} to "${normalizedName}"`)

  return {
    ...fileRecord,
    name: normalizedName,
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
    throw new Error(`Failed to delete file: ${getErrorMessage(error, 'Unknown error')}`)
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
        (candidate) => fileExistsInWorkspace(workspaceId, candidate, null),
        { hasExtension: true }
      )
      attemptedRestoreName = newName

      await db
        .update(workspaceFiles)
        .set({ deletedAt: null, folderId: null, originalName: newName, updatedAt: new Date() })
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
