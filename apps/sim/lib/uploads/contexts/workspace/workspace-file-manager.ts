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
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import type { ShareRecord } from '@/lib/api/contracts/public-shares'
import {
  decrementStorageUsageForBillingContextInTx,
  incrementStorageUsageForBillingContextInTx,
  maybeNotifyStorageLimitForBillingContext,
  resolveStorageBillingContext,
} from '@/lib/billing/storage'
import { normalizeVfsSegment } from '@/lib/copilot/vfs/normalize-segment'
import { canonicalWorkspaceFilePath, decodeVfsPathSegments } from '@/lib/copilot/vfs/path-utils'
import { resolveWorkflowAliasForWorkspace } from '@/lib/copilot/vfs/workflow-alias-resolver'
import { isReservedWorkflowAliasBackingDisplayPath } from '@/lib/copilot/vfs/workflow-aliases'
import { generateRestoreName } from '@/lib/core/utils/restore-name'
import type { DbOrTx } from '@/lib/db/types'
import { getServePathPrefix } from '@/lib/uploads'
import {
  deleteFile,
  downloadFile,
  hasCloudStorage,
  headObject,
  uploadFile,
} from '@/lib/uploads/core/storage-service'
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
  /** Pass-through to `downloadFile` when not default `workspace` (e.g. chat mothership uploads). */
  storageContext?: 'workspace' | 'mothership'
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

interface WorkspaceFileMetadataInsert {
  id: string
  key: string
  userId: string
  workspaceId: string
  folderId: string | null
  originalName: string
  contentType: string
  size: number
}

/**
 * Attempts one active workspace-file insert and reports the row that this call
 * created. Conflict losers receive `undefined` and must inspect the active key
 * in the same transaction before deciding whether the operation is idempotent.
 */
async function insertWorkspaceFileMetadataInTx(
  tx: DbOrTx,
  metadata: WorkspaceFileMetadataInsert
): Promise<typeof workspaceFiles.$inferSelect | undefined> {
  const [inserted] = await tx
    .insert(workspaceFiles)
    .values({
      ...metadata,
      context: 'workspace',
      displayName: metadata.originalName,
      deletedAt: null,
      uploadedAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning()
  return inserted
}

class WorkspaceFileRegistrationConflictError extends Error {
  constructor(key: string) {
    super(`Storage key ${key} is already registered to a different workspace file operation`)
  }
}

/**
 * Reads one active metadata row by its unique storage key.
 */
async function findActiveWorkspaceFileByKey(
  executor: DbOrTx,
  key: string
): Promise<typeof workspaceFiles.$inferSelect | undefined> {
  const [file] = await executor
    .select()
    .from(workspaceFiles)
    .where(and(eq(workspaceFiles.key, key), isNull(workspaceFiles.deletedAt)))
    .limit(1)
  return file
}

/**
 * Reads one workspace file for a lifecycle transition, including archived rows.
 */
async function findWorkspaceFileForLifecycle(
  executor: DbOrTx,
  workspaceId: string,
  fileId: string
): Promise<typeof workspaceFiles.$inferSelect | undefined> {
  const [file] = await executor
    .select()
    .from(workspaceFiles)
    .where(
      and(
        eq(workspaceFiles.id, fileId),
        eq(workspaceFiles.workspaceId, workspaceId),
        eq(workspaceFiles.context, 'workspace')
      )
    )
    .limit(1)
  return file
}

/**
 * Confirms that an active-key conflict belongs to the same direct-upload
 * operation. The generated storage key is the operation identity; immutable
 * ownership and object attributes prevent unrelated callers from reusing it.
 */
function isSameWorkspaceFileRegistration(
  file: typeof workspaceFiles.$inferSelect,
  params: {
    workspaceId: string
    userId: string
    key: string
    folderId: string | null
    contentType: string
    size: number
  }
): boolean {
  return (
    file.key === params.key &&
    file.workspaceId === params.workspaceId &&
    file.userId === params.userId &&
    file.folderId === params.folderId &&
    file.context === 'workspace' &&
    file.contentType === params.contentType &&
    file.size === params.size &&
    file.deletedAt === null
  )
}

/**
 * Removes a blob whose metadata transaction failed. Cleanup is intentionally
 * outside the database transaction and never masks the finalization error.
 */
async function cleanupWorkspaceStorageObject(key: string, reason: string): Promise<void> {
  try {
    await deleteFile({ key, context: 'workspace' })
  } catch (error) {
    logger.error(`Failed to clean up workspace object after ${reason}`, error)
  }
}

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
  const storageBillingContext = await resolveStorageBillingContext(workspaceId)

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
        persistMetadata: false,
      })

      logger.info(`Upload returned key: ${uploadResult.key}`)

      let updatedUsage: number | undefined
      try {
        const finalized = await db.transaction(async (tx) => {
          const inserted = await insertWorkspaceFileMetadataInTx(tx, {
            id: fileId,
            key: uploadResult.key,
            userId,
            workspaceId,
            folderId,
            originalName: uniqueName,
            contentType,
            size: fileBuffer.length,
          })
          if (!inserted) {
            throw new FileConflictError(uniqueName)
          }
          const usage = await incrementStorageUsageForBillingContextInTx(
            tx,
            storageBillingContext,
            fileBuffer.length
          )
          return { inserted, updatedUsage: usage }
        })
        fileId = finalized.inserted.id
        updatedUsage = finalized.updatedUsage
      } catch (finalizationError) {
        await cleanupWorkspaceStorageObject(uploadResult.key, 'metadata finalization failure')
        throw finalizationError
      }

      void maybeNotifyStorageLimitForBillingContext(storageBillingContext, updatedUsage)

      logger.info(
        `Successfully uploaded workspace file: ${uniqueName} with key: ${uploadResult.key}`
      )

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
        if (exactName) {
          throw error
        }
        logger.warn(
          `Unique name conflict on upload (attempt ${attempt + 1}/${MAX_UPLOAD_UNIQUE_RETRIES}), retrying with a new name`
        )
        continue
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
  const folderId = await assertWorkspaceFileFolderTarget(workspaceId, params.folderId)

  if (verifiedSize > MAX_WORKSPACE_FILE_SIZE) {
    await cleanupWorkspaceStorageObject(key, 'size-cap rejection')
    throw new Error(`File size exceeds maximum of ${MAX_WORKSPACE_FILE_SIZE} bytes`)
  }

  const registrationIdentity = {
    workspaceId,
    userId,
    key,
    folderId,
    contentType,
    size: verifiedSize,
  }
  const existing = await findActiveWorkspaceFileByKey(db, key)
  if (existing) {
    if (!isSameWorkspaceFileRegistration(existing, registrationIdentity)) {
      throw new WorkspaceFileRegistrationConflictError(key)
    }
    logger.info(`Using existing metadata record for direct upload: ${key}`)
    const pathPrefix = getServePathPrefix()
    return {
      file: {
        id: existing.id,
        name: existing.originalName,
        size: existing.size,
        type: existing.contentType,
        url: `${pathPrefix}${encodeURIComponent(existing.key)}?context=workspace`,
        key: existing.key,
        context: 'workspace',
      },
      created: false,
    }
  }

  const storageBillingContext = await resolveStorageBillingContext(workspaceId)
  for (let attempt = 0; attempt < MAX_UPLOAD_UNIQUE_RETRIES; attempt++) {
    const fileId = `wf_${generateShortId()}`
    const displayName = await allocateUniqueWorkspaceFileName(
      workspaceId,
      normalizedOriginalName,
      folderId
    )

    const finalized = await db.transaction(async (tx) => {
      const inserted = await insertWorkspaceFileMetadataInTx(tx, {
        id: fileId,
        key,
        userId,
        workspaceId,
        folderId,
        originalName: displayName,
        contentType,
        size: verifiedSize,
      })
      if (!inserted) {
        const raceWinner = await findActiveWorkspaceFileByKey(tx, key)
        if (!raceWinner) return { kind: 'name-conflict' } as const
        if (!isSameWorkspaceFileRegistration(raceWinner, registrationIdentity)) {
          throw new WorkspaceFileRegistrationConflictError(key)
        }
        return { kind: 'existing', file: raceWinner } as const
      }

      const updatedUsage = await incrementStorageUsageForBillingContextInTx(
        tx,
        storageBillingContext,
        verifiedSize
      )
      return { kind: 'created', file: inserted, updatedUsage } as const
    })

    if (finalized.kind === 'name-conflict') {
      logger.warn(
        `Unique name conflict on register (attempt ${attempt + 1}/${MAX_UPLOAD_UNIQUE_RETRIES}), retrying with a new name`
      )
      continue
    }

    if (finalized.kind === 'created') {
      void maybeNotifyStorageLimitForBillingContext(storageBillingContext, finalized.updatedUsage)
    }

    const pathPrefix = getServePathPrefix()
    return {
      file: {
        id: finalized.file.id,
        name: finalized.file.originalName,
        size: finalized.file.size,
        type: finalized.file.contentType,
        url: `${pathPrefix}${encodeURIComponent(finalized.file.key)}?context=workspace`,
        key: finalized.file.key,
        context: 'workspace',
      },
      created: finalized.kind === 'created',
    }
  }

  throw new FileConflictError(normalizedOriginalName)
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
  size: number
): Promise<{ displayName: string }> {
  for (let n = 1; n <= MAX_CHAT_DISPLAY_NAME_RETRIES; n++) {
    const candidate = suffixedName(fileName, n)
    try {
      const updated = await db
        .update(workspaceFiles)
        .set({ chatId, context: 'mothership', displayName: candidate })
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
  return {
    id: file.id,
    workspaceId: file.workspaceId || workspaceId,
    name: file.originalName,
    key: file.key,
    path: `${pathPrefix}${encodeURIComponent(file.key)}?context=workspace`,
    size: file.size,
    type: file.contentType,
    uploadedBy: file.userId,
    folderId: file.folderId,
    folderPath: file.folderId ? (folderPaths.get(file.folderId) ?? null) : null,
    deletedAt: file.deletedAt,
    uploadedAt: file.uploadedAt,
    updatedAt: file.updatedAt,
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
 * Updates a workspace file through a versioned object swap. Blob I/O completes
 * before the short metadata-and-ledger transaction.
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

  const storageBillingContext = await resolveStorageBillingContext(workspaceId)
  const nextContentType = contentType || fileRecord.type
  const nextStorageKey = generateWorkspaceFileKey(workspaceId, fileRecord.name)

  try {
    const metadata: Record<string, string> = {
      originalName: fileRecord.name,
      uploadedAt: new Date().toISOString(),
      purpose: 'workspace',
      userId,
      workspaceId,
      ...(fileRecord.folderId ? { folderId: fileRecord.folderId } : {}),
    }

    const uploadResult = await uploadFile({
      file: content,
      fileName: nextStorageKey,
      contentType: nextContentType,
      context: 'workspace',
      preserveKey: true,
      customKey: nextStorageKey,
      metadata,
      persistMetadata: false,
    })

    let finalized: {
      file: typeof workspaceFiles.$inferSelect
      oldKey: string
      sizeDiff: number
      updatedUsage: number | undefined
    }
    try {
      finalized = await db.transaction(async (tx) => {
        const [currentFile] = await tx
          .select()
          .from(workspaceFiles)
          .where(
            and(
              eq(workspaceFiles.id, fileId),
              eq(workspaceFiles.workspaceId, workspaceId),
              eq(workspaceFiles.context, 'workspace'),
              isNull(workspaceFiles.deletedAt)
            )
          )
          .for('update')
          .limit(1)
        if (!currentFile) {
          throw new Error('File not found')
        }

        const sizeDiff = content.length - currentFile.size
        const [updatedFile] = await tx
          .update(workspaceFiles)
          .set({
            key: uploadResult.key,
            size: content.length,
            contentType: nextContentType,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(workspaceFiles.id, fileId),
              eq(workspaceFiles.workspaceId, workspaceId),
              eq(workspaceFiles.context, 'workspace'),
              isNull(workspaceFiles.deletedAt)
            )
          )
          .returning()
        if (!updatedFile) {
          throw new Error('File not found or could not be updated')
        }

        let updatedUsage: number | undefined
        if (sizeDiff > 0) {
          updatedUsage = await incrementStorageUsageForBillingContextInTx(
            tx,
            storageBillingContext,
            sizeDiff
          )
        } else if (sizeDiff < 0) {
          await decrementStorageUsageForBillingContextInTx(
            tx,
            storageBillingContext,
            Math.abs(sizeDiff)
          )
        }

        return {
          file: updatedFile,
          oldKey: currentFile.key,
          sizeDiff,
          updatedUsage,
        }
      })
    } catch (finalizationError) {
      await cleanupWorkspaceStorageObject(uploadResult.key, 'overwrite finalization failure')
      throw finalizationError
    }

    if (finalized.sizeDiff !== 0) {
      void maybeNotifyStorageLimitForBillingContext(
        storageBillingContext,
        finalized.updatedUsage,
        finalized.sizeDiff < 0
      )
    }
    if (finalized.oldKey !== uploadResult.key) {
      await cleanupWorkspaceStorageObject(finalized.oldKey, 'version replacement')
    }

    const pathPrefix = getServePathPrefix()
    const currentFolderPath =
      finalized.file.folderId === fileRecord.folderId ? fileRecord.folderPath : null

    logger.info(`Successfully updated workspace file content: ${finalized.file.originalName}`)

    return {
      id: finalized.file.id,
      workspaceId: finalized.file.workspaceId || workspaceId,
      name: finalized.file.originalName,
      key: finalized.file.key,
      path: `${pathPrefix}${encodeURIComponent(finalized.file.key)}?context=workspace`,
      size: finalized.file.size,
      type: finalized.file.contentType,
      uploadedBy: finalized.file.userId,
      folderId: finalized.file.folderId,
      folderPath: currentFolderPath,
      deletedAt: finalized.file.deletedAt,
      uploadedAt: finalized.file.uploadedAt,
      updatedAt: finalized.file.updatedAt,
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
 * Move and/or rename a workspace file in one atomic row update. Either side
 * may be a no-op (same folder = pure rename, same name = pure move); when
 * both are unchanged the record is returned untouched. Conflicts at the
 * destination throw {@link FileConflictError}. The `renamed`/`moved` flags
 * report what actually changed, computed from the same read the update uses.
 */
export async function moveRenameWorkspaceFile(params: {
  workspaceId: string
  fileId: string
  targetFolderId: string | null
  newName: string
}): Promise<{ file: WorkspaceFileRecord; renamed: boolean; moved: boolean }> {
  const normalizedName = normalizeWorkspaceFileItemName(params.newName.trim(), 'File')

  const fileRecord = await getWorkspaceFile(params.workspaceId, params.fileId)
  if (!fileRecord) {
    throw new Error('File not found')
  }

  const targetFolderId = await assertWorkspaceFileFolderTarget(
    params.workspaceId,
    params.targetFolderId
  )
  const currentFolderId = fileRecord.folderId ?? null
  const renamed = fileRecord.name !== normalizedName
  const moved = currentFolderId !== targetFolderId
  if (!renamed && !moved) {
    return { file: fileRecord, renamed, moved }
  }

  const exists = await fileExistsInWorkspace(params.workspaceId, normalizedName, targetFolderId)
  if (exists) {
    throw new FileConflictError(normalizedName)
  }

  let updated: { id: string }[]
  try {
    updated = await db
      .update(workspaceFiles)
      .set({ originalName: normalizedName, folderId: targetFolderId, updatedAt: new Date() })
      .where(
        and(
          eq(workspaceFiles.id, params.fileId),
          eq(workspaceFiles.workspaceId, params.workspaceId),
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
    throw new Error('File not found or could not be moved')
  }

  return {
    file: {
      ...fileRecord,
      name: normalizedName,
      folderId: targetFolderId,
    },
    renamed,
    moved,
  }
}

/**
 * Soft delete a workspace file.
 */
export async function deleteWorkspaceFile(workspaceId: string, fileId: string): Promise<void> {
  logger.info(`Deleting workspace file: ${fileId}`)

  try {
    const fileRecord = await findWorkspaceFileForLifecycle(db, workspaceId, fileId)
    if (!fileRecord) {
      throw new Error('File not found')
    }
    if (fileRecord.deletedAt) return

    const [archived] = await db
      .update(workspaceFiles)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(workspaceFiles.id, fileId),
          eq(workspaceFiles.workspaceId, workspaceId),
          eq(workspaceFiles.context, 'workspace'),
          isNull(workspaceFiles.deletedAt)
        )
      )
      .returning()
    if (!archived) return

    logger.info(`Successfully archived workspace file: ${archived.originalName}`)
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

  const fileRecord = await findWorkspaceFileForLifecycle(db, workspaceId, fileId)
  if (!fileRecord) {
    throw new Error('File not found')
  }

  if (!fileRecord.deletedAt) {
    return
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
        fileRecord.originalName,
        (candidate) => fileExistsInWorkspace(workspaceId, candidate, null),
        { hasExtension: true }
      )
      attemptedRestoreName = newName

      const [restored] = await db
        .update(workspaceFiles)
        .set({ deletedAt: null, folderId: null, originalName: newName, updatedAt: new Date() })
        .where(
          and(
            eq(workspaceFiles.id, fileId),
            eq(workspaceFiles.workspaceId, workspaceId),
            eq(workspaceFiles.context, 'workspace'),
            isNotNull(workspaceFiles.deletedAt)
          )
        )
        .returning()
      if (!restored) return

      logger.info(`Successfully restored workspace file: ${newName}`)
      return
    } catch (error: unknown) {
      if (getPostgresErrorCode(error) !== '23505') {
        throw error
      }
      if (attempt === maxUniqueViolationRetries - 1) {
        throw new FileConflictError(attemptedRestoreName || fileRecord.originalName)
      }
    }
  }
}
