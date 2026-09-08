/**
 * Workspace file storage system
 * Files uploaded at workspace level persist indefinitely and are accessible across all workflows
 */

import { randomBytes } from 'crypto'
import { db } from '@sim/db'
import {
  uploadSession,
  type WorkspaceFileRow,
  workspace,
  workspaceFileColumns,
  workspaceFiles,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import {
  describeError,
  getErrorMessage,
  getPostgresConstraintName,
  getPostgresErrorCode,
} from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { omit } from '@sim/utils/object'
import { and, eq, inArray, isNotNull, isNull, or, type SQL, sql } from 'drizzle-orm'
import type { ShareRecord } from '@/lib/api/contracts/public-shares'
import type { V2FileSortBy } from '@/lib/api/contracts/v2/files'
import type { ListSortOrder } from '@/lib/api/list-query'
import {
  type CursorKey,
  encodeKeyset,
  INVALID_CURSOR_MESSAGE,
  type KeysetKey,
  keysetAfter,
  keysetColumns,
  listOrderBy,
  numberKey,
  searchFilter,
  textKey,
  timestampKey,
} from '@/lib/api/list-query'
import {
  decrementStorageUsageForBillingContextInTx,
  incrementStorageUsageForBillingContextInTx,
  maybeNotifyStorageLimitForBillingContext,
  resolveStorageBillingContext,
} from '@/lib/billing/storage'
import {
  CollabDocStateConflictError,
  type PreparedCollabDocState,
  saveCollabDocStateInTx,
} from '@/lib/collab-doc/collab-state'
import { normalizeVfsSegment } from '@/lib/copilot/vfs/normalize-segment'
import { canonicalWorkspaceFilePath, decodeVfsPathSegments } from '@/lib/copilot/vfs/path-utils'
import { asOrchestrationError, OrchestrationError } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { generateRestoreName } from '@/lib/core/utils/restore-name'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import type { DbOrTx } from '@/lib/db/types'
import { acquireFolderMutationLock } from '@/lib/folders/locks'
import { parseFolderPath } from '@/lib/folders/paths'
import { loadActiveFolderPathIndex, resolveFolderPathFromIndex } from '@/lib/folders/queries'
import type { FolderIdScope } from '@/lib/folders/scope'
import { notifyWorkspaceFilesChanged } from '@/lib/realtime/notify'
import { getServePathPrefix } from '@/lib/uploads'
import type { WorkspaceFileFolderRecord } from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import {
  enqueueWorkspaceFileLiveDocReconciliation,
  processWorkspaceFileLiveDocReconciliationNow,
} from '@/lib/uploads/contexts/workspace/workspace-file-live-doc-outbox'
import {
  EXACT_EMPTY_WORKSPACE_FILE_SECRET_PROVENANCE,
  initializeWorkspaceFileSecretProvenanceInTx,
  preserveWorkspaceFileSecretProvenanceInTx,
  replaceWorkspaceFileSecretProvenanceInTx,
  type WorkspaceFileSecretProvenance,
  type WorkspaceFileSecretProvenancePolicy,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import {
  enqueueWorkspaceFileStorageCleanup,
  processWorkspaceFileStorageCleanupNow,
} from '@/lib/uploads/contexts/workspace/workspace-file-storage-cleanup-outbox'
import { buildStorageKeySegment } from '@/lib/uploads/core/storage-key'
import {
  deleteFile,
  downloadFile,
  hasCloudStorage,
  headObject,
  uploadFile,
} from '@/lib/uploads/core/storage-service'
import { getWorkspaceFileSize, MAX_WORKSPACE_FILE_SIZE } from '@/lib/uploads/shared/types'
import { isMarkdownFile } from '@/lib/uploads/utils/file-utils'
import { SIM_PAGE_CONTENT_TYPE } from '@/lib/workspace-files/page-compile'
import {
  MAX_SIM_PAGE_UPLOAD_SNIFF_BYTES,
  restoreSimPageSourceBuffer,
} from '@/lib/workspace-files/page-source-embed'
import { getWorkspaceWithOwner } from '@/lib/workspaces/permissions/utils'
import { isUuid } from '@/executor/constants'
import type { UserFile } from '@/executor/types'
import {
  assertWorkspaceFileFolderTarget,
  buildWorkspaceFileFolderPathMap,
  fileNameExistsInWorkspaceFolder,
  findWorkspaceFileFolderIdByPath,
  getWorkspaceFileFolderPath,
  listWorkspaceFileFolders,
  normalizeWorkspaceFileItemName,
  resolveWorkspaceFileFolderTarget,
} from './workspace-file-folder-manager'

const logger = createLogger('WorkspaceFileStorage')

export type WorkspaceFileScope = 'active' | 'archived' | 'all'

/**
 * An {@link OrchestrationError} so every surface reaches 409 by class rather than by
 * searching the message for "already exists". Carries the inherited `code: 'conflict'`;
 * the old `'FILE_EXISTS'` discriminator had no readers.
 */
export class FileConflictError extends OrchestrationError {
  constructor(name: string) {
    super('conflict', `A file named "${name}" already exists in this workspace`)
    this.name = 'FileConflictError'
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
  /** Intrinsic image pixel dimensions, populated lazily on first view. Null/absent for non-images. */
  width?: number | null
  height?: number | null
  uploadedBy: string
  folderId?: string | null
  folderPath?: string | null
  deletedAt?: Date | null
  uploadedAt: Date
  updatedAt: Date
  /**
   * Content-scoped version (see the `content_updated_at` column): advances only on content writes, never
   * on metadata. The collab persist's optimistic-concurrency validator. Optional on the DTO because
   * display/mothership constructors don't carry it — the real DB mapper (the only source seed/persist
   * read) always populates it from the NOT NULL column.
   */
  contentUpdatedAt?: Date | null
  /** Pass-through to `downloadFile` when not default `workspace` (e.g. chat mothership uploads). */
  storageContext?: 'workspace' | 'mothership'
  /** Public share state, attached at the API boundary. `null` when never shared. */
  share?: ShareRecord | null
}

export interface UploadedWorkspaceFileRecord extends WorkspaceFileRecord {
  url: string
  context: 'workspace'
  folderId: string | null
  folderPath: string | null
  deletedAt: Date | null
}

export interface ActiveWorkspaceFileContext {
  fileId: string
  workspaceId: string
  workspaceOrganizationId: string | null
  allowPersonalApiKeys: boolean
  billedAccountUserId: string
}

export interface WorkspaceFileLifecycleContext extends ActiveWorkspaceFileContext {
  deletedAt: Date | null
}

export interface ActiveWorkspaceContext {
  workspaceId: string
  workspaceOrganizationId: string | null
  allowPersonalApiKeys: boolean
  billedAccountUserId: string
}

interface ListWorkspaceFilesOptions {
  scope?: WorkspaceFileScope
  folders?: WorkspaceFileFolderRecord[]
  hydrateFolderPaths?: boolean
  /** Propagate storage errors when an incomplete list would be unsafe. */
  throwOnError?: boolean
  /**
   * Row cap for callers that only need to know whether the workspace fits a budget.
   * The result is a prefix of the full list, so a caller that reads it as "the
   * workspace's files" must not set this.
   */
  limit?: number
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
  return `workspace/${workspaceId}/${buildStorageKeySegment(`${timestamp}-${random}-`, fileName)}`
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
): Promise<WorkspaceFileRow | undefined> {
  const [inserted] = await tx
    .insert(workspaceFiles)
    .values({
      ...omit(metadata, ['size']),
      sizeBytes: metadata.size,
      context: 'workspace',
      displayName: metadata.originalName,
      deletedAt: null,
      uploadedAt: new Date(),
      updatedAt: new Date(),
      // Creation IS the first content write, so stamp the content version too (metadata writes never do).
      contentUpdatedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning(workspaceFileColumns)
  return inserted
}

class WorkspaceFileRegistrationConflictError extends Error {
  constructor(key: string) {
    super(`Storage key ${key} is already registered to a different workspace file operation`)
  }
}

/**
 * Reads metadata by upload-operation key across its full lifecycle, preferring an active row.
 */
async function findWorkspaceFileByRegistrationKey(
  executor: DbOrTx,
  key: string
): Promise<WorkspaceFileRow | undefined> {
  const files = await executor
    .select(workspaceFileColumns)
    .from(workspaceFiles)
    .where(eq(workspaceFiles.key, key))
    .orderBy(sql`${workspaceFiles.deletedAt} IS NULL DESC`)
    .limit(1)
  return files[0]
}

/**
 * Reads one workspace file for a lifecycle transition, including archived rows.
 */
async function findWorkspaceFileForLifecycle(
  executor: DbOrTx,
  workspaceId: string,
  fileId: string
): Promise<WorkspaceFileRow | undefined> {
  const [file] = await executor
    .select(workspaceFileColumns)
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
 * Confirms that a key belongs to the same upload-session
 * operation. The generated storage key is the operation identity; immutable
 * ownership and object attributes prevent unrelated callers from reusing it.
 */
function isSameWorkspaceFileRegistration(
  file: WorkspaceFileRow,
  params: {
    workspaceId: string
    userId: string
    key: string
    contentType: string
    size: number
  }
): boolean {
  return (
    file.key === params.key &&
    file.workspaceId === params.workspaceId &&
    file.userId === params.userId &&
    file.context === 'workspace' &&
    file.contentType === params.contentType &&
    getWorkspaceFileSize(file) === params.size
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
  options?: {
    folderId?: string | null
    folderPath?: string
    exactName?: boolean
    secretProvenance?: WorkspaceFileSecretProvenance
    notifyWorkspaceChange?: boolean
  }
): Promise<UploadedWorkspaceFileRecord> {
  logger.info(`Uploading workspace file: ${fileName} for workspace ${workspaceId}`)

  if (options?.folderId !== undefined && options.folderPath !== undefined) {
    throw new OrchestrationError('validation', 'Specify either folderId or folderPath, not both')
  }

  let folderId: string | null
  let folderPath: string | null
  if (options?.folderPath !== undefined) {
    const folderPathSegments = parseFolderPath(options.folderPath)
    const folderIndex = await loadActiveFolderPathIndex(workspaceId, 'file')
    const resolvedFolderId = resolveFolderPathFromIndex(folderIndex, options.folderPath)
    if (resolvedFolderId === undefined) {
      throw new OrchestrationError('not_found', 'Target folder not found')
    }
    folderId = resolvedFolderId
    folderPath = resolvedFolderId ? folderPathSegments.join('/') : null
  } else {
    const folderTarget = await resolveWorkspaceFileFolderTarget(workspaceId, options?.folderId)
    folderId = folderTarget?.id ?? null
    folderPath = folderTarget?.path ?? null
  }
  const normalizedFileName = normalizeWorkspaceFileItemName(fileName, 'File')
  const pageRestore = restoreSimPageSourceBuffer(normalizedFileName, fileBuffer)
  const effectiveBuffer = pageRestore?.buffer ?? fileBuffer
  const effectiveName = pageRestore?.name ?? normalizedFileName
  const effectiveContentType = pageRestore ? SIM_PAGE_CONTENT_TYPE : contentType
  const exactName = options?.exactName ?? false
  const storageBillingContext = await resolveStorageBillingContext(workspaceId)

  let lastError: unknown
  const maxAttempts = exactName ? 1 : MAX_UPLOAD_UNIQUE_RETRIES
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const uniqueName = exactName
      ? effectiveName
      : await allocateUniqueWorkspaceFileName(workspaceId, effectiveName, folderId)
    if (exactName && (await fileExistsInWorkspace(workspaceId, uniqueName, folderId))) {
      throw new FileConflictError(uniqueName)
    }
    const storageKey = generateWorkspaceFileKey(workspaceId, uniqueName)
    const fileId = `wf_${generateShortId()}`

    try {
      logger.info(`Generated storage key: ${storageKey}`)

      const metadata: Record<string, string> = {
        originalName: uniqueName,
        uploadedAt: new Date().toISOString(),
        purpose: 'workspace',
        userId: userId,
        workspaceId: workspaceId,
        ...(folderId && options?.folderPath === undefined ? { folderId } : {}),
      }

      const uploadResult = await uploadFile({
        file: effectiveBuffer,
        fileName: storageKey,
        contentType: effectiveContentType,
        context: 'workspace',
        preserveKey: true,
        customKey: storageKey,
        metadata,
        persistMetadata: false,
      })

      logger.info(`Upload returned key: ${uploadResult.key}`)

      let finalized: {
        inserted: WorkspaceFileRow
        updatedUsage: number | undefined
      }
      try {
        finalized = await db.transaction(async (tx) => {
          await acquireFolderMutationLock(tx, workspaceId, 'file')
          let activeFolderId: string | null
          if (options?.folderPath !== undefined) {
            const folderIndex = await loadActiveFolderPathIndex(workspaceId, 'file', tx)
            const resolvedFolderId = resolveFolderPathFromIndex(folderIndex, options.folderPath)
            if (resolvedFolderId === undefined) {
              throw new OrchestrationError('not_found', 'Target folder not found')
            }
            activeFolderId = resolvedFolderId
          } else {
            activeFolderId = await assertWorkspaceFileFolderTarget(workspaceId, folderId, tx)
          }
          const inserted = await insertWorkspaceFileMetadataInTx(tx, {
            id: fileId,
            key: uploadResult.key,
            userId,
            workspaceId,
            folderId: activeFolderId,
            originalName: uniqueName,
            contentType: effectiveContentType,
            size: effectiveBuffer.length,
          })
          if (!inserted) {
            throw new FileConflictError(uniqueName)
          }
          if (options?.secretProvenance) {
            await replaceWorkspaceFileSecretProvenanceInTx(
              tx,
              inserted.id,
              inserted.contentUpdatedAt,
              options.secretProvenance
            )
          }
          const usage = await incrementStorageUsageForBillingContextInTx(
            tx,
            storageBillingContext,
            effectiveBuffer.length
          )
          return { inserted, updatedUsage: usage }
        })
      } catch (finalizationError) {
        await cleanupWorkspaceStorageObject(uploadResult.key, 'metadata finalization failure')
        throw finalizationError
      }

      void maybeNotifyStorageLimitForBillingContext(storageBillingContext, finalized.updatedUsage)

      logger.info(
        `Successfully uploaded workspace file: ${uniqueName} with key: ${uploadResult.key}`
      )

      if (options?.notifyWorkspaceChange !== false) {
        await notifyWorkspaceFilesChanged(workspaceId)
      }

      return mapUploadedWorkspaceFileRecord(finalized.inserted, workspaceId, folderPath)
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
          throw new FileConflictError(effectiveName)
        }
        logger.warn(
          `Unique name conflict on upload (attempt ${attempt + 1}/${MAX_UPLOAD_UNIQUE_RETRIES}), retrying with a new name`
        )
        continue
      }
      // A classified failure (a blown storage quota, a missing target folder) keeps its class:
      // re-wrapping it in a bare Error is what forced every caller to substring-match the
      // message to recover the status.
      const classified = asOrchestrationError(error)
      if (classified) throw classified
      logger.error(`Failed to upload workspace file ${fileName}:`, {
        cause: describeError(error),
      })
      throw new Error(`Failed to upload file: ${getErrorMessage(error, 'Unknown error')}`, {
        cause: error,
      })
    }
  }

  logger.error(`Failed to upload workspace file after ${MAX_UPLOAD_UNIQUE_RETRIES} attempts`, {
    cause: describeError(lastError),
  })
  throw new FileConflictError(fileName)
}

/**
 * Finalize a workspace file that was uploaded through a transfer session
 * (signed PUT or completed multipart). Verifies the object exists,
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

/**
 * Detects a page-source upload on the presigned/multipart path, whose bytes
 * are already in storage at registration time. Returns the page registration
 * values plus, for a compiled standalone download, the extracted source bytes
 * to write back at the same key.
 *
 * The write-back must NOT happen here: until the registration transaction
 * records the session's completed file id, a finalize retry re-verifies the
 * stored object against the session's declared size and content type
 * (assertObjectIdentity in upload-session/service.ts), and a rewritten object
 * would fail that check on every retry, permanently stranding the session.
 * The caller performs the rewrite strictly AFTER the transaction commits —
 * from then on retries take the completed-file path and never re-verify — and
 * a replay that arrives before a rewrite landed re-detects the still-compiled
 * bytes and rewrites after its own commit.
 */
async function detectUploadedSimPageSource(params: {
  key: string
  name: string
  size: number
}): Promise<{ contentType: string; name: string; size: number; rewrite: Buffer | null } | null> {
  const { key, name, size } = params
  if (!name.toLowerCase().endsWith('.html')) return null
  if (size === 0 || size > MAX_SIM_PAGE_UPLOAD_SNIFF_BYTES) return null
  let uploaded: Buffer
  try {
    uploaded = await downloadFile({ key, context: 'workspace' })
  } catch (error) {
    logger.warn(`Page-source sniff skipped for ${key}: ${getErrorMessage(error)}`)
    return null
  }
  const restored = restoreSimPageSourceBuffer(name, uploaded)
  if (restored === null) return null
  return {
    contentType: SIM_PAGE_CONTENT_TYPE,
    name: restored.name,
    size: restored.buffer.length,
    rewrite: restored.buffer === uploaded ? null : restored.buffer,
  }
}

export async function registerUploadedWorkspaceFile(params: {
  workspaceId: string
  userId: string
  key: string
  originalName: string
  contentType: string
  folderId?: string | null
  uploadSessionId?: string
}): Promise<RegisterUploadedWorkspaceFileResult> {
  const { workspaceId, userId, key, originalName, contentType } = params
  const normalizedOriginalName = normalizeWorkspaceFileItemName(originalName, 'File')

  if (parseWorkspaceFileKey(key) !== workspaceId) {
    throw new Error('Storage key does not belong to this workspace')
  }

  const head = await headObject(key, 'workspace')
  if (!head) {
    throw new Error('Uploaded object not found in storage')
  }
  const verifiedSize = head.size

  if (verifiedSize > MAX_WORKSPACE_FILE_SIZE) {
    await cleanupWorkspaceStorageObject(key, 'size-cap rejection')
    throw new Error(`File size exceeds maximum of ${MAX_WORKSPACE_FILE_SIZE} bytes`)
  }

  const pageRestore = await detectUploadedSimPageSource({
    key,
    name: normalizedOriginalName,
    size: verifiedSize,
  })
  const effectiveContentType = pageRestore?.contentType ?? contentType
  const effectiveName = pageRestore?.name ?? normalizedOriginalName
  const effectiveSize = pageRestore?.size ?? verifiedSize
  /**
   * Swaps the compiled bytes for the extracted page source, strictly after the
   * registration transaction committed (see detectUploadedSimPageSource).
   * Best-effort: the row is already committed, so a failure here leaves a
   * page-typed file whose bytes are the compiled document — it still renders
   * everywhere (the compiled doc is self-contained) and only loses source
   * editing until rewritten, which beats failing a registration that
   * succeeded.
   */
  const commitPageRestoreRewrite = async () => {
    if (!pageRestore?.rewrite) return
    try {
      await uploadFile({
        file: pageRestore.rewrite,
        fileName: key,
        contentType: SIM_PAGE_CONTENT_TYPE,
        context: 'workspace',
        preserveKey: true,
        customKey: key,
        persistMetadata: false,
      })
    } catch (error) {
      logger.error(`Page-source rewrite failed after registration for ${key}`, {
        cause: describeError(error),
      })
    }
  }

  const registrationIdentity = {
    workspaceId,
    userId,
    key,
    contentType: effectiveContentType,
    size: effectiveSize,
  }
  const existing = await db.transaction(async (tx) => {
    const found = await findWorkspaceFileByRegistrationKey(tx, key)
    if (!found) return undefined
    if (!isSameWorkspaceFileRegistration(found, registrationIdentity)) {
      throw new WorkspaceFileRegistrationConflictError(key)
    }
    assertActiveWorkspaceFileRegistration(found)
    if (found.secretProvenanceVersion === 1) {
      await initializeWorkspaceFileSecretProvenanceInTx(
        tx,
        found.id,
        found.contentUpdatedAt,
        EXACT_EMPTY_WORKSPACE_FILE_SECRET_PROVENANCE
      )
    }
    await markUploadSessionFileRegistered(tx, params.uploadSessionId, workspaceId, found.id)
    return found
  })
  if (existing) {
    logger.info(`Using existing metadata record for upload session: ${key}`)
    await commitPageRestoreRewrite()
    const pathPrefix = getServePathPrefix()
    return {
      file: {
        id: existing.id,
        name: existing.originalName,
        size: getWorkspaceFileSize(existing),
        type: existing.contentType,
        url: `${pathPrefix}${encodeURIComponent(existing.key)}?context=workspace`,
        key: existing.key,
        context: 'workspace',
      },
      created: false,
    }
  }

  const folderId = params.folderId ?? null

  const storageBillingContext = await resolveStorageBillingContext(workspaceId)
  for (let attempt = 0; attempt < MAX_UPLOAD_UNIQUE_RETRIES; attempt++) {
    const fileId = `wf_${generateShortId()}`
    const displayName = await allocateUniqueWorkspaceFileName(workspaceId, effectiveName, folderId)

    const finalized = await db.transaction(async (tx) => {
      await acquireFolderMutationLock(tx, workspaceId, 'file')
      const activeFolderId = await assertWorkspaceFileFolderTarget(workspaceId, folderId, tx)
      const inserted = await insertWorkspaceFileMetadataInTx(tx, {
        id: fileId,
        key,
        userId,
        workspaceId,
        folderId: activeFolderId,
        originalName: displayName,
        contentType: effectiveContentType,
        size: effectiveSize,
      })
      if (!inserted) {
        const raceWinner = await findWorkspaceFileByRegistrationKey(tx, key)
        if (!raceWinner) return { kind: 'name-conflict' } as const
        if (!isSameWorkspaceFileRegistration(raceWinner, registrationIdentity)) {
          throw new WorkspaceFileRegistrationConflictError(key)
        }
        assertActiveWorkspaceFileRegistration(raceWinner)
        if (raceWinner.secretProvenanceVersion === 1) {
          await initializeWorkspaceFileSecretProvenanceInTx(
            tx,
            raceWinner.id,
            raceWinner.contentUpdatedAt,
            EXACT_EMPTY_WORKSPACE_FILE_SECRET_PROVENANCE
          )
        }
        await markUploadSessionFileRegistered(
          tx,
          params.uploadSessionId,
          workspaceId,
          raceWinner.id
        )
        return { kind: 'existing', file: raceWinner } as const
      }

      const updatedUsage = await incrementStorageUsageForBillingContextInTx(
        tx,
        storageBillingContext,
        effectiveSize
      )
      await replaceWorkspaceFileSecretProvenanceInTx(
        tx,
        inserted.id,
        inserted.contentUpdatedAt,
        EXACT_EMPTY_WORKSPACE_FILE_SECRET_PROVENANCE
      )
      await markUploadSessionFileRegistered(tx, params.uploadSessionId, workspaceId, inserted.id)
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

    await commitPageRestoreRewrite()
    const pathPrefix = getServePathPrefix()
    return {
      file: {
        id: finalized.file.id,
        name: finalized.file.originalName,
        size: getWorkspaceFileSize(finalized.file),
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

async function markUploadSessionFileRegistered(
  tx: DbOrTx,
  uploadSessionId: string | undefined,
  workspaceId: string,
  fileId: string
): Promise<void> {
  if (!uploadSessionId) return
  const [marked] = await tx
    .update(uploadSession)
    .set({ completedFileId: fileId, updatedAt: new Date() })
    .where(
      and(
        eq(uploadSession.id, uploadSessionId),
        eq(uploadSession.workspaceId, workspaceId),
        eq(uploadSession.purpose, 'workspace_file'),
        eq(uploadSession.status, 'finalizing'),
        or(isNull(uploadSession.completedFileId), eq(uploadSession.completedFileId, fileId))
      )
    )
    .returning({ id: uploadSession.id })
  if (!marked) throw new Error('Workspace upload registration marker could not be persisted')
}

function assertActiveWorkspaceFileRegistration(file: WorkspaceFileRow): void {
  if (file.deletedAt) {
    throw new OrchestrationError('conflict', 'Upload result was deleted')
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
 * Raised when a caller-supplied storage key may not be bound to a chat upload —
 * it addresses another workspace, or it already has a `workspace_files` record
 * the caller does not own as an active chat upload.
 */
export class WorkspaceFileKeyOwnershipError extends Error {
  readonly code = 'KEY_NOT_OWNED' as const
  constructor(key: string) {
    super(`Storage key is not available for a chat attachment: ${key}`)
  }
}

type ClaimableChatUploadRow = { kind: 'update'; id: string } | { kind: 'insert' }

/**
 * Decide how `trackChatUpload` may bind `s3Key`, or reject the key outright.
 *
 * Only two outcomes are safe. Either the caller already owns an active
 * chat-upload row for the key (re-linking their own upload to a chat), or the
 * key has no `workspace_files` record whatsoever and a fresh binding can be
 * minted. Anything else — another member's row, a `context='workspace'` file,
 * or a soft-deleted record whose object is still readable through the binding —
 * belongs to somebody else's file and must not be touched.
 *
 * Soft-deleted rows count: the active-key unique index is partial on
 * `deleted_at IS NULL`, so inserting over an archived row would succeed and
 * hand the caller read access to the archived file's bytes.
 *
 * An upload also binds to exactly one chat: a row already linked to a different
 * chat is not claimable, matching the 409 the sibling `local-files/stage` route
 * returns for the same case. Re-sending the key within its own chat still works.
 */
async function resolveClaimableChatUploadRow(
  workspaceId: string,
  userId: string,
  chatId: string,
  s3Key: string
): Promise<ClaimableChatUploadRow> {
  const rows = await db
    .select({
      id: workspaceFiles.id,
      userId: workspaceFiles.userId,
      workspaceId: workspaceFiles.workspaceId,
      context: workspaceFiles.context,
      chatId: workspaceFiles.chatId,
      deletedAt: workspaceFiles.deletedAt,
    })
    .from(workspaceFiles)
    .where(eq(workspaceFiles.key, s3Key))

  if (rows.length === 0) {
    return { kind: 'insert' }
  }

  const owned = rows.find(
    (row) =>
      row.userId === userId &&
      row.workspaceId === workspaceId &&
      row.context === 'mothership' &&
      row.deletedAt === null &&
      (row.chatId === null || row.chatId === chatId)
  )

  if (!owned) {
    throw new WorkspaceFileKeyOwnershipError(s3Key)
  }

  return { kind: 'update', id: owned.id }
}

/**
 * Track a file that was already uploaded to workspace S3 as a chat-scoped upload.
 * Links the existing workspaceFiles metadata record (created by the storage service
 * during upload) to the chat by setting chatId and context='mothership'.
 * Falls back to inserting a new record if none exists for the key.
 *
 * `s3Key` reaches this function from client-supplied request bodies, and
 * `workspace_files.key` is the trusted binding every file authorization check
 * resolves the owning workspace from. So the key is treated as untrusted here:
 * it must address the target workspace, it may only re-link a chat-upload row
 * the caller already owns, and minting a brand-new binding requires the key to
 * have no prior record at all. Without those invariants a member could hand in
 * another member's key and re-parent their file (hiding it from the workspace
 * Files listing, or destroying it through the chat-delete FK cascade).
 *
 * Allocates a collision-free `displayName` (the partial unique index on
 * (chat_id, display_name) WHERE context='mothership' enforces this) and returns it
 * so callers can surface the same name to the model in the VFS read hint.
 * This is a metadata-only operation: it preserves any content provenance already
 * attached to the uploaded bytes. Direct user uploads use the established
 * exact-empty/legacy classification and do not need a chat-time reclassification.
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
  if (parseWorkspaceFileKey(s3Key) !== workspaceId) {
    throw new WorkspaceFileKeyOwnershipError(s3Key)
  }

  const claimable = await resolveClaimableChatUploadRow(workspaceId, userId, chatId, s3Key)

  if (claimable.kind === 'insert' && hasCloudStorage()) {
    // Hygiene only — the format and no-prior-record guards above already carry
    // authorization, and a binding to a nonexistent object grants nothing
    // readable. So reject only on a definitive not-found (`null`); a provider
    // 5xx/throttle throws, and failing the attachment on that would drop a
    // legitimate >50MB multipart upload (the sole path reaching this branch).
    let head: Awaited<ReturnType<typeof headObject>> = null
    try {
      head = await headObject(s3Key, 'workspace')
    } catch (error) {
      logger.warn('Chat upload existence probe failed; proceeding on the ownership guards', {
        key: s3Key,
        error: getErrorMessage(error),
      })
      head = { size }
    }
    if (!head) {
      throw new WorkspaceFileKeyOwnershipError(s3Key)
    }
  }

  for (let n = 1; n <= MAX_CHAT_DISPLAY_NAME_RETRIES; n++) {
    const candidate = suffixedName(fileName, n)
    try {
      if (claimable.kind === 'update') {
        await db.transaction(async (tx) => {
          const updated = await tx
            .update(workspaceFiles)
            .set({
              chatId,
              messageId: messageId ?? null,
              context: 'mothership',
              displayName: candidate,
            })
            .where(
              and(
                eq(workspaceFiles.id, claimable.id),
                eq(workspaceFiles.userId, userId),
                eq(workspaceFiles.workspaceId, workspaceId),
                eq(workspaceFiles.context, 'mothership'),
                isNull(workspaceFiles.deletedAt),
                // Compare-and-swap on the chat binding: an upload belongs to one
                // chat. Two overlapping requests both observe `chat_id IS NULL`,
                // but only the first satisfies this predicate — the loser matches
                // zero rows and fails closed instead of stealing the binding and
                // its delete-cascade lifecycle.
                or(isNull(workspaceFiles.chatId), eq(workspaceFiles.chatId, chatId))
              )
            )
            .returning({ id: workspaceFiles.id })

          if (updated.length === 0) {
            // The ownership lookup is a separate statement, so re-assert every
            // predicate here — this UPDATE is the atomic check. A concurrent
            // `save_upload` flips the same row to context='workspace' and
            // clears chatId; matching on id alone would drag that saved file back
            // into chat scope, hiding it from the Files listing and re-exposing it
            // to the chat-delete cascade.
            throw new WorkspaceFileKeyOwnershipError(s3Key)
          }
        })

        logger.info(
          `Linked existing file record to chat: ${fileName} (display: ${candidate}) for chat ${chatId}`
        )
        return { displayName: candidate }
      }

      const fileId = `wf_${generateShortId()}`

      await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(workspaceFiles)
          .values({
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
            sizeBytes: size,
          })
          .returning({ id: workspaceFiles.id })

        if (!inserted) {
          throw new Error(`Failed to track chat upload for key: ${s3Key}`)
        }
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
  file: WorkspaceFileListRow,
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
    size: getWorkspaceFileSize(file),
    type: file.contentType,
    width: file.width,
    height: file.height,
    uploadedBy: file.userId,
    folderId: file.folderId,
    folderPath: file.folderId ? (folderPaths.get(file.folderId) ?? null) : null,
    deletedAt: file.deletedAt,
    uploadedAt: file.uploadedAt,
    updatedAt: file.updatedAt,
    contentUpdatedAt: file.contentUpdatedAt,
  }
}

function mapUploadedWorkspaceFileRecord(
  file: WorkspaceFileRow,
  workspaceId: string,
  folderPath: string | null
): UploadedWorkspaceFileRecord {
  const record = mapWorkspaceFileRecord(
    file,
    workspaceId,
    file.folderId && folderPath ? new Map([[file.folderId, folderPath]]) : new Map()
  )
  return {
    ...record,
    url: record.path,
    context: 'workspace',
    folderId: record.folderId ?? null,
    folderPath: record.folderPath ?? null,
    deletedAt: record.deletedAt ?? null,
  }
}

async function mapSingleWorkspaceFileRecord(
  file: WorkspaceFileRow,
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
 * Store an image file's intrinsic pixel dimensions (a pure rendering hint used to reserve layout space
 * before the image loads). The client reports the browser's own EXIF-corrected `naturalWidth/Height`, and
 * only when it differs from what's stored, so this overwrites rather than backfilling once — a stale value
 * self-corrects on the next view instead of sticking behind a `width IS NULL` guard.
 *
 * `key` is a content-version guard: the write commits only if the row still has the storage key the
 * client measured. The key is regenerated on every content replacement, so an in-flight write measured
 * against superseded bytes is rejected here rather than persisting the old aspect ratio for new content.
 * Does NOT touch `updatedAt` — dimensions are not content and must not cache-bust the served image bytes.
 * Returns whether a live row was written.
 */
export async function updateWorkspaceFileDimensions(
  workspaceId: string,
  fileId: string,
  dimensions: { key: string; width: number; height: number }
): Promise<boolean> {
  const updated = await db
    .update(workspaceFiles)
    .set({ width: dimensions.width, height: dimensions.height })
    .where(
      and(
        eq(workspaceFiles.id, fileId),
        eq(workspaceFiles.workspaceId, workspaceId),
        eq(workspaceFiles.key, dimensions.key),
        isNull(workspaceFiles.deletedAt)
      )
    )
    .returning({ id: workspaceFiles.id })
  return updated.length > 0
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
    .select(workspaceFileColumns)
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

/** Workspace-file rows for one scope: live, Recently Deleted, or both. */
function workspaceFileScopeCondition(workspaceId: string, scope: WorkspaceFileScope) {
  const base = [
    eq(workspaceFiles.workspaceId, workspaceId),
    eq(workspaceFiles.context, 'workspace'),
  ]
  if (scope === 'all') return and(...base)
  return scope === 'archived'
    ? and(...base, isNotNull(workspaceFiles.deletedAt))
    : and(...base, isNull(workspaceFiles.deletedAt))
}

/**
 * The columns {@link mapWorkspaceFileRecord} reads. These list reads are workspace-wide,
 * so `select()` would ship five unprojected columns for every row of the scan.
 */
const workspaceFileListColumns = {
  id: workspaceFiles.id,
  key: workspaceFiles.key,
  userId: workspaceFiles.userId,
  workspaceId: workspaceFiles.workspaceId,
  folderId: workspaceFiles.folderId,
  originalName: workspaceFiles.originalName,
  contentType: workspaceFiles.contentType,
  sizeBytes: workspaceFiles.sizeBytes,
  width: workspaceFiles.width,
  height: workspaceFiles.height,
  deletedAt: workspaceFiles.deletedAt,
  uploadedAt: workspaceFiles.uploadedAt,
  updatedAt: workspaceFiles.updatedAt,
  contentUpdatedAt: workspaceFiles.contentUpdatedAt,
} as const

/** A row carrying exactly the columns {@link mapWorkspaceFileRecord} needs; a full row satisfies it. */
type WorkspaceFileListRow = Pick<WorkspaceFileRow, keyof typeof workspaceFileListColumns>

/** Resolves `folderPath` for a page of rows, reading the folder tree only if any row needs it. */
async function hydrateWorkspaceFilePaths(
  files: WorkspaceFileListRow[],
  workspaceId: string,
  options?: { folders?: WorkspaceFileFolderRecord[]; hydrateFolderPaths?: boolean }
): Promise<WorkspaceFileRecord[]> {
  const needsFolderPaths =
    files.some((file) => file.folderId) && (options?.hydrateFolderPaths ?? true)
  const folders = needsFolderPaths
    ? (options?.folders ?? (await listWorkspaceFileFolders(workspaceId, { scope: 'all' })))
    : []
  const folderPaths = needsFolderPaths ? buildWorkspaceFileFolderPathMap(folders) : new Map()
  return files.map((file) => mapWorkspaceFileRecord(file, workspaceId, folderPaths))
}

/**
 * List all files for a workspace
 */
export async function listWorkspaceFiles(
  workspaceId: string,
  options?: ListWorkspaceFilesOptions
): Promise<WorkspaceFileRecord[]> {
  try {
    const { scope = 'active', limit } = options ?? {}
    const query = db
      .select(workspaceFileListColumns)
      .from(workspaceFiles)
      .where(workspaceFileScopeCondition(workspaceId, scope))
      .orderBy(workspaceFiles.uploadedAt)
    const files = await (limit === undefined ? query : query.limit(limit))

    return await hydrateWorkspaceFilePaths(files, workspaceId, options)
  } catch (error) {
    logger.error(`Failed to list workspace files for ${workspaceId}:`, error)
    if (options?.throwOnError) throw error
    return []
  }
}

/**
 * The keysets behind {@link queryWorkspaceFiles}' sortable fields. `satisfies`
 * makes this total over the contract enum: a new sortable field in the contract
 * fails to compile until it has a keyset here, rather than silently falling
 * through to an unordered scan.
 *
 * Every key column is `NOT NULL`, and `id` closes each keyset so a page
 * boundary inside a run of equal names/sizes/timestamps is still stable.
 */
const fileId = textKey<WorkspaceFileRecord>(workspaceFiles.id, (row) => row.id)

const WORKSPACE_FILE_SORTS = {
  name: [textKey(workspaceFiles.originalName, (row) => row.name), fileId],
  size: [
    numberKey(sql<number>`${workspaceFiles.sizeBytes}`.mapWith(Number), (row) => row.size),
    fileId,
  ],
  uploadedAt: [timestampKey(workspaceFiles.uploadedAt, (row) => row.uploadedAt), fileId],
  updatedAt: [timestampKey(workspaceFiles.updatedAt, (row) => row.updatedAt), fileId],
} satisfies Record<V2FileSortBy, readonly KeysetKey<WorkspaceFileRecord>[]>

export interface QueryWorkspaceFilesOptions {
  scope?: WorkspaceFileScope
  /** Restrict to one file folder. */
  /** `undefined` lists every folder, `null` lists only root files. */
  /**
   * The folder to match: one id, `null` for the workspace root, or several ids for a folder
   * and its descendants. Omit to match every folder.
   *
   * An empty array matches nothing — the honest answer for an empty set of folders, and the
   * shape Drizzle already emits (`false`) for an empty `IN`.
   */
  folderId?: string | null | readonly string[]
  /** A resolved union of folder ids and workspace-root files. */
  folderScope?: FolderIdScope
  /** Case-insensitive substring match on the file name. */
  search?: string
  sortBy: V2FileSortBy
  sortOrder: ListSortOrder
  limit: number
  /** Keyset values from a cursor, in the sort's key order. */
  after?: CursorKey[]
}

export interface QueryWorkspaceFilesResult {
  files: WorkspaceFileRecord[]
  /** Keyset values to resume from, or `null` when this page is the last one. */
  nextKeys: CursorKey[] | null
}

/** The folder predicate for {@link QueryWorkspaceFilesOptions.folderId}'s three shapes. */
function workspaceFileFolderCondition(
  folderId: string | null | readonly string[] | undefined
): SQL | undefined {
  if (folderId === undefined) return undefined
  if (folderId === null) return isNull(workspaceFiles.folderId)
  if (Array.isArray(folderId)) return inArray(workspaceFiles.folderId, folderId)
  return eq(workspaceFiles.folderId, folderId as string)
}

/** The SQL predicate for a folder scope that can include both ids and root files. */
function workspaceFileFolderScopeCondition(scope: FolderIdScope | undefined): SQL | undefined {
  if (!scope) return undefined
  const ids = [...scope.folderIds]
  const inScope = ids.length > 0 ? inArray(workspaceFiles.folderId, ids) : undefined
  const atRoot = scope.includeRootItems ? isNull(workspaceFiles.folderId) : undefined
  if (inScope && atRoot) return or(inScope, atRoot)
  return inScope ?? atRoot ?? sql`false`
}

/**
 * One filtered, sorted, bounded page of a workspace's files.
 *
 * Distinct from {@link listWorkspaceFiles}, which materializes the whole scope
 * for callers that genuinely need it. Here the filter, the ordering, and the
 * slice are all in the query: a name search must not become "read every row,
 * then discard almost all of them in JS".
 *
 * Throws rather than returning a short page — a swallowed storage error here is
 * indistinguishable from "no more results" and would silently end pagination.
 * A cursor that does not fit the requested sort is a classified `validation`
 * failure, so the route renders it as a 400 rather than a 500.
 */
export async function queryWorkspaceFiles(
  workspaceId: string,
  options: QueryWorkspaceFilesOptions
): Promise<QueryWorkspaceFilesResult> {
  const {
    scope = 'active',
    folderId,
    folderScope,
    search,
    sortBy,
    sortOrder,
    limit,
    after,
  } = options
  if (folderId !== undefined && folderScope !== undefined) {
    throw new OrchestrationError('validation', 'Specify either folderId or folderScope, not both')
  }
  const keys: readonly KeysetKey<WorkspaceFileRecord>[] = WORKSPACE_FILE_SORTS[sortBy]

  let resumeAfter: SQL | undefined
  if (after) {
    const condition = keysetAfter(keys, after, sortOrder)
    if (!condition) throw new OrchestrationError('validation', INVALID_CURSOR_MESSAGE)
    resumeAfter = condition
  }

  const conditions = [
    workspaceFileScopeCondition(workspaceId, scope),
    workspaceFileFolderCondition(folderId),
    workspaceFileFolderScopeCondition(folderScope),
    searchFilter(workspaceFiles.originalName, search),
    resumeAfter,
  ]

  const rows = await db
    .select(workspaceFileListColumns)
    .from(workspaceFiles)
    .where(and(...conditions))
    .orderBy(...listOrderBy(keysetColumns(keys), sortOrder))
    .limit(limit + 1)

  const hasMore = rows.length > limit
  const files = await hydrateWorkspaceFilePaths(rows.slice(0, limit), workspaceId)
  const last = files.at(-1)

  return { files, nextKeys: hasMore && last ? encodeKeyset(keys, last) : null }
}

/**
 * Normalize a workspace file reference to either a display name or canonical file ID.
 * Supports raw IDs, `files/{name}`, `files/{name}/content`, and `files/{name}/meta.json`.
 * Files are addressed by their sanitized canonical path; id-based VFS paths are not supported.
 */
export function normalizeWorkspaceFileReference(fileReference: string): string {
  return normalizeWorkspaceFileReferenceSegments(fileReference).join('/')
}

function normalizeWorkspaceFileReferenceSegments(fileReference: string): string[] {
  const trimmed = fileReference.trim().replace(/^\/+/, '')
  const withoutDeletedPrefix = trimmed.startsWith('recently-deleted/')
    ? trimmed.slice('recently-deleted/'.length)
    : trimmed

  if (withoutDeletedPrefix.startsWith('files/')) {
    const withoutPrefix = withoutDeletedPrefix.slice('files/'.length)
    if (withoutPrefix.endsWith('/meta.json')) {
      return decodeVfsPathSegments(withoutPrefix.slice(0, -'/meta.json'.length))
    }
    if (withoutPrefix.endsWith('/content')) {
      return decodeVfsPathSegments(withoutPrefix.slice(0, -'/content'.length))
    }
    return decodeVfsPathSegments(withoutPrefix)
  }

  return decodeVfsPathSegments(withoutDeletedPrefix)
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

  const referenceSegments = normalizeWorkspaceFileReferenceSegments(fileReference)
  const normalizedReference = referenceSegments.join('/')
  const normalizedIdMatch = files.find((file) => file.id === normalizedReference)
  if (normalizedIdMatch) {
    return normalizedIdMatch
  }

  const segmentKey = referenceSegments.map(normalizeVfsSegment).join('/')
  const normalizedPathMatch = files.find(
    (file) =>
      canonicalWorkspaceFilePath({ folderPath: file.folderPath, name: file.name }).slice(
        'files/'.length
      ) === segmentKey
  )
  if (normalizedPathMatch) return normalizedPathMatch

  return files.find((file) => normalizeVfsSegment(file.name) === segmentKey) ?? null
}

async function getWorkspaceFileByExactReference(
  workspaceId: string,
  segments: string[]
): Promise<WorkspaceFileRecord | null> {
  if (segments.length === 0) return null
  if (segments.length === 1) {
    return getWorkspaceFileByName(workspaceId, segments[0], { folderId: null })
  }

  const folderId = await findWorkspaceFileFolderIdByPath(workspaceId, segments.slice(0, -1))
  return folderId ? getWorkspaceFileByName(workspaceId, segments.at(-1) ?? '', { folderId }) : null
}

/**
 * Resolve a workspace file record from either its id or a VFS/name reference.
 */
export async function resolveWorkspaceFileReference(
  workspaceId: string,
  fileReference: string
): Promise<WorkspaceFileRecord | null> {
  const referenceSegments = normalizeWorkspaceFileReferenceSegments(fileReference)
  const normalizedReference = referenceSegments.join('/')
  if (normalizedReference.startsWith('wf_')) {
    const file = await getWorkspaceFile(workspaceId, normalizedReference, { throwOnError: true })
    if (file) return file
  }

  const exactReferenceFile = await getWorkspaceFileByExactReference(workspaceId, referenceSegments)
  if (exactReferenceFile) return exactReferenceFile

  const files = await listWorkspaceFiles(workspaceId)
  return findWorkspaceFileRecord(files, fileReference)
}

/**
 * Load the canonical authorization context for an active workspace file by resource ID.
 * Database failures propagate so callers never confuse unavailable state with a missing file.
 */
export async function loadActiveWorkspaceFileContext(
  fileId: string,
  options?: { includeDeleted?: boolean }
): Promise<ActiveWorkspaceFileContext | null> {
  const [context] = await db
    .select({
      fileId: workspaceFiles.id,
      workspaceId: workspace.id,
      workspaceOrganizationId: workspace.organizationId,
      allowPersonalApiKeys: workspace.allowPersonalApiKeys,
      billedAccountUserId: workspace.billedAccountUserId,
    })
    .from(workspaceFiles)
    .innerJoin(workspace, eq(workspaceFiles.workspaceId, workspace.id))
    .where(
      and(
        eq(workspaceFiles.id, fileId),
        eq(workspaceFiles.context, 'workspace'),
        ...(options?.includeDeleted ? [] : [isNull(workspaceFiles.deletedAt)]),
        isNull(workspace.archivedAt)
      )
    )
    .limit(1)

  return context ?? null
}

/**
 * Load a workspace file for a lifecycle transition, including archived files.
 * The workspace archive state is returned by the canonical workspace record and is enforced by
 * the operation's manager primitive where the transition requires an active workspace.
 */
export async function loadWorkspaceFileLifecycleContext(
  fileId: string
): Promise<WorkspaceFileLifecycleContext | null> {
  const [context] = await db
    .select({
      fileId: workspaceFiles.id,
      workspaceId: workspace.id,
      workspaceOrganizationId: workspace.organizationId,
      allowPersonalApiKeys: workspace.allowPersonalApiKeys,
      billedAccountUserId: workspace.billedAccountUserId,
      deletedAt: workspaceFiles.deletedAt,
    })
    .from(workspaceFiles)
    .innerJoin(workspace, eq(workspaceFiles.workspaceId, workspace.id))
    .where(and(eq(workspaceFiles.id, fileId), eq(workspaceFiles.context, 'workspace')))
    .limit(1)

  return context ?? null
}

/**
 * Load the canonical authorization context for an active workspace.
 *
 * The query deliberately throws database failures so callers cannot mistake an unavailable
 * workspace for a missing one. Authentication and authorization remain the caller's concern.
 */
export async function loadActiveWorkspaceContext(
  workspaceId: string
): Promise<ActiveWorkspaceContext | null> {
  const [context] = await db
    .select({
      workspaceId: workspace.id,
      workspaceOrganizationId: workspace.organizationId,
      allowPersonalApiKeys: workspace.allowPersonalApiKeys,
      billedAccountUserId: workspace.billedAccountUserId,
    })
    .from(workspace)
    .where(and(eq(workspace.id, workspaceId), isNull(workspace.archivedAt)))
    .limit(1)

  return context ?? null
}

/**
 * Get a specific workspace file.
 *
 * By default a DB error is logged and swallowed to `null` — for most callers "couldn't load it"
 * and "doesn't exist" are handled the same way. Pass `{ throwOnError: true }` when the caller must
 * distinguish a genuinely-absent file (`null`) from a transient read failure (throws): the
 * collaborative-doc seed builder relies on this so a DB blip never looks like an empty file and gets
 * seeded as blank content over the real document.
 */
export async function getWorkspaceFile(
  workspaceId: string,
  fileId: string,
  options?: { includeDeleted?: boolean; throwOnError?: boolean }
): Promise<WorkspaceFileRecord | null> {
  try {
    const { includeDeleted = false } = options ?? {}
    const files = await db
      .select(workspaceFileColumns)
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
    if (options?.throwOnError) throw error
    return null
  }
}

/**
 * Download the bytes a user should actually receive for a workspace file.
 *
 * Generated docs (docx/pptx/pdf/xlsx) store their GENERATION SOURCE as the primary
 * file, so {@link fetchWorkspaceFileBuffer} hands back JavaScript/Python text under
 * a `.docx` name. This resolves the rendered artifact instead, and is what every
 * download/attachment surface should call. Reach for the raw reader only when the
 * source itself is wanted (style extraction, compile checks, the copilot VFS).
 *
 * Throws `DocCompileUserError` when a generated doc's artifact is still compiling —
 * callers turn that into a retryable 409 rather than shipping source.
 */
export async function fetchServableWorkspaceFileBuffer(
  fileRecord: WorkspaceFileRecord,
  options: { maxBytes: number; signal?: AbortSignal; requestId?: string }
): Promise<{ buffer: Buffer; contentType: string }> {
  const { downloadServableFileFromStorage } = await import('@/lib/uploads/utils/file-utils.server')

  return downloadServableFileFromStorage(
    {
      id: fileRecord.id,
      name: fileRecord.name,
      url: fileRecord.url ?? fileRecord.path,
      size: fileRecord.size,
      type: fileRecord.type,
      key: fileRecord.key,
      context: fileRecord.storageContext ?? 'workspace',
    },
    options.requestId ?? generateRequestId(),
    logger,
    options
  )
}

/**
 * Download raw workspace file content. For generated docs this is the GENERATION
 * SOURCE, not the rendered document — see {@link fetchServableWorkspaceFileBuffer}.
 */
export async function fetchWorkspaceFileBuffer(
  fileRecord: WorkspaceFileRecord,
  options: { maxBytes: number; signal?: AbortSignal }
): Promise<Buffer> {
  logger.info(`Downloading workspace file: ${fileRecord.name}`)

  try {
    const buffer = await downloadFile({
      key: fileRecord.key,
      context: fileRecord.storageContext ?? 'workspace',
      maxBytes: options.maxBytes,
      signal: options.signal,
    })
    logger.info(
      `Successfully downloaded workspace file: ${fileRecord.name} (${buffer.length} bytes)`
    )
    return buffer
  } catch (error) {
    // A cancelled read is not a download failure: surface the abort itself so the
    // caller sees cancellation, not a transport error it might retry or record.
    options.signal?.throwIfAborted()
    logger.error(`Failed to download workspace file ${fileRecord.name}:`, error)
    // Rethrow a `maxBytes` breach unwrapped: callers distinguish "too large" from a
    // transport failure to answer with their own placeholder, and re-wrapping it in a
    // plain Error would erase the only thing that tells the two apart.
    if (isPayloadSizeLimitError(error)) throw error
    throw new Error(`Failed to download file: ${getErrorMessage(error, 'Unknown error')}`)
  }
}

/**
 * Thrown by {@link updateWorkspaceFileContent} when its `expectedUpdatedAt` optimistic-concurrency
 * guard fails — the file changed out-of-band since the caller read it. Callers catch this to reconcile
 * (re-read + merge) rather than overwrite. Not a failure: the durable file is left untouched.
 */
export class ContentVersionConflictError extends Error {
  constructor(readonly fileId: string) {
    super(`Workspace file ${fileId} changed since it was read (optimistic-concurrency conflict)`)
    this.name = 'ContentVersionConflictError'
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
  contentType?: string,
  options?: {
    /**
     * Whether to stream this write into any open collaborative editor as a live CRDT merge. Defaults
     * to `true`, so EVERY external write path (copilot tools, the file tool, the content route) reaches
     * an open editor through this one chokepoint — no per-writer wiring to forget. Pass `false` only
     * for a write that must NOT touch the live doc: the relay's own project-to-markdown persist (which
     * would otherwise merge the doc back into itself in a loop), and empty-shell creates whose real
     * content arrives via a subsequent write.
     */
    syncLiveDoc?: boolean
    /**
     * Optimistic-concurrency guard (RFC 7232 `If-Match` semantics). When set, the write commits only
     * if the file's `contentUpdatedAt` still equals this value — no content write intervened; otherwise it
     * throws {@link ContentVersionConflictError} without clobbering. Checked against the
     * `SELECT … FOR UPDATE`-locked row, so it is atomic with the write. Used by the collab persist so
     * projecting the live doc back to markdown can never silently overwrite an out-of-band edit.
     */
    expectedUpdatedAt?: Date
    /** Commit with the markdown projection; requires the expected content version. */
    collabDocState?: PreparedCollabDocState
    /**
     * Derived edits must explicitly preserve; trusted whole replacements must explicitly replace.
     * An omitted policy is classified as unknown rather than inheriting provenance across new bytes.
     */
    secretProvenancePolicy?: WorkspaceFileSecretProvenancePolicy
  }
): Promise<WorkspaceFileRecord> {
  if (options?.collabDocState && !options.expectedUpdatedAt) {
    throw new Error('Collaborative state updates require an expected content version')
  }
  logger.info(`Updating workspace file content: ${fileId} for workspace ${workspaceId}`)

  const fileRecord = await getWorkspaceFile(workspaceId, fileId)
  if (!fileRecord) {
    throw new OrchestrationError('not_found', 'File not found')
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
      file: WorkspaceFileRow
      oldKey: string
      sizeDiff: number
      updatedUsage: number | undefined
      liveDocEventId: string | undefined
    }
    try {
      finalized = await db.transaction(async (tx) => {
        const [currentFile] = await tx
          .select(workspaceFileColumns)
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
          throw new OrchestrationError('not_found', 'File not found')
        }

        // Optimistic-concurrency guard: the row is `FOR UPDATE`-locked, so comparing its committed
        // CONTENT version to the caller's expected value and then writing is atomic — a racing writer
        // blocks here until this transaction resolves. Compare `contentUpdatedAt` (which advances only on
        // content writes), NOT `updatedAt` (which a rename/move also bumps): guarding on `updatedAt` let a
        // metadata bump masquerade as an out-of-band CONTENT change, so a racing live-doc persist would
        // reconcile stale durable content and clobber in-flight edits. Coalesce to `updatedAt` for rows
        // predating the column. A mismatch means the CONTENT changed out-of-band; abort rather than clobber.
        if (
          options?.expectedUpdatedAt &&
          currentFile.contentUpdatedAt.getTime() !== options.expectedUpdatedAt.getTime()
        ) {
          throw new ContentVersionConflictError(fileId)
        }

        if (options?.collabDocState) {
          await saveCollabDocStateInTx(tx, fileId, options.collabDocState)
        }

        const sizeDiff = content.length - getWorkspaceFileSize(currentFile)
        const now = new Date()
        // `contentUpdatedAt` is the persist If-Match token, so it MUST be strictly monotonic per file — a
        // bare `new Date()` is not: cross-instance clock skew can stamp a later write with an earlier time,
        // breaking the version ordering the whole optimistic-concurrency scheme relies on (stuck If-Match,
        // wrong reconcile). We hold this row's FOR UPDATE lock, so `currentFile.contentUpdatedAt` is the
        // latest committed value; stamp strictly after it. (Also removes same-millisecond collisions.)
        // `updatedAt` stays plain wall-clock — it is display/sort only, never the concurrency token.
        const contentUpdatedAt = new Date(
          Math.max(now.getTime(), currentFile.contentUpdatedAt.getTime() + 1)
        )
        const [updatedFile] = await tx
          .update(workspaceFiles)
          .set({
            key: uploadResult.key,
            sizeBytes: content.length,
            contentType: nextContentType,
            // Replaced bytes: drop the old image's dimensions so the row never describes stale content.
            // The next view reserves nothing (the baseline first-load reflow) rather than a wrong-sized
            // box, then the browser's measurement backfills the correct value. No server-side decode here
            // (avoids EXIF-orientation guesswork), and a late in-flight PATCH that lands after this is
            // corrected on the next view since the client overwrites on mismatch.
            width: null,
            height: null,
            updatedAt: now,
            contentUpdatedAt,
          })
          .where(
            and(
              eq(workspaceFiles.id, fileId),
              eq(workspaceFiles.workspaceId, workspaceId),
              eq(workspaceFiles.context, 'workspace'),
              isNull(workspaceFiles.deletedAt)
            )
          )
          .returning(workspaceFileColumns)
        if (!updatedFile) {
          throw new OrchestrationError('not_found', 'File not found or could not be updated')
        }

        if (options?.secretProvenancePolicy?.mode === 'replace') {
          await replaceWorkspaceFileSecretProvenanceInTx(
            tx,
            fileId,
            updatedFile.contentUpdatedAt,
            options.secretProvenancePolicy.provenance
          )
        } else if (options?.secretProvenancePolicy?.mode === 'preserve') {
          await preserveWorkspaceFileSecretProvenanceInTx(
            tx,
            fileId,
            currentFile.contentUpdatedAt,
            currentFile.secretProvenanceVersion,
            updatedFile.contentUpdatedAt
          )
        } else {
          await replaceWorkspaceFileSecretProvenanceInTx(tx, fileId, updatedFile.contentUpdatedAt, {
            status: 'unknown',
          })
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

        const liveDocEventId =
          options?.syncLiveDoc !== false &&
          (isMarkdownFile({ type: currentFile.contentType, name: currentFile.originalName }) ||
            isMarkdownFile({ type: updatedFile.contentType, name: updatedFile.originalName }))
            ? await enqueueWorkspaceFileLiveDocReconciliation(tx, {
                workspaceId,
                fileId,
                version: updatedFile.contentUpdatedAt.getTime(),
              })
            : undefined

        return {
          file: updatedFile,
          oldKey: currentFile.key,
          sizeDiff,
          updatedUsage,
          liveDocEventId,
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

    if (finalized.liveDocEventId) {
      try {
        const result = await processWorkspaceFileLiveDocReconciliationNow(finalized.liveDocEventId)
        if (result !== 'completed') {
          logger.warn('Live document reconciliation deferred to outbox retry', {
            workspaceId,
            fileId,
            eventId: finalized.liveDocEventId,
            result,
          })
        }
      } catch (error) {
        logger.warn('Live document reconciliation deferred after inline processing error', {
          workspaceId,
          fileId,
          eventId: finalized.liveDocEventId,
          error: getErrorMessage(error),
        })
      }
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
      size: getWorkspaceFileSize(finalized.file),
      type: finalized.file.contentType,
      uploadedBy: finalized.file.userId,
      folderId: finalized.file.folderId,
      folderPath: currentFolderPath,
      deletedAt: finalized.file.deletedAt,
      uploadedAt: finalized.file.uploadedAt,
      updatedAt: finalized.file.updatedAt,
      contentUpdatedAt: finalized.file.contentUpdatedAt,
    }
  } catch (error) {
    // Preserve the typed conflict so callers can catch it and reconcile — it's an expected outcome of
    // the optimistic-concurrency guard, not a failure to wrap. The orphan upload was already cleaned up
    // by the inner finalization catch before it propagated here.
    if (
      error instanceof ContentVersionConflictError ||
      error instanceof CollabDocStateConflictError
    ) {
      throw error
    }
    // Same reasoning for an already-classified failure: a missing file and a blown storage quota are
    // caller-fixable outcomes that every surface maps to 404/413 by class. Re-wrapping them in a bare
    // Error stripped that classification and turned both into a 500.
    const classified = asOrchestrationError(error)
    if (classified) throw classified
    logger.error(`Failed to update workspace file content ${fileId}:`, error)
    throw new Error(`Failed to update file content: ${getErrorMessage(error, 'Unknown error')}`, {
      cause: error,
    })
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

  const fileRecord = await getWorkspaceFile(workspaceId, fileId, { throwOnError: true })
  if (!fileRecord) {
    throw new OrchestrationError('not_found', 'File not found')
  }

  if (fileRecord.name === normalizedName) {
    return fileRecord
  }

  const exists = await fileExistsInWorkspace(workspaceId, normalizedName, fileRecord.folderId)
  if (exists) {
    throw new FileConflictError(normalizedName)
  }

  let updated: { id: string }[]
  const renamedAt = new Date()
  try {
    updated = await db
      .update(workspaceFiles)
      .set({ originalName: normalizedName, updatedAt: renamedAt })
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
    throw new OrchestrationError('not_found', 'File not found or could not be renamed')
  }

  logger.info(`Successfully renamed workspace file ${fileId} to "${normalizedName}"`)

  return {
    ...fileRecord,
    name: normalizedName,
    updatedAt: renamedAt,
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
    throw new OrchestrationError('not_found', 'File not found')
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
    throw new OrchestrationError('not_found', 'File not found or could not be moved')
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
      throw new OrchestrationError('not_found', 'File not found')
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
      .returning(workspaceFileColumns)
    if (!archived) return

    logger.info(`Successfully archived workspace file: ${archived.originalName}`)
  } catch (error) {
    logger.error(`Failed to delete workspace file ${fileId}:`, error)
    throw error
  }
}

/**
 * Permanently removes a file created by an in-flight archive extraction only while
 * its name, folder, and update timestamp still match the creation result. The matching
 * metadata deletion, accounting update, and durable storage-cleanup event commit together. This
 * is rollback-only: ordinary user deletion remains recoverable through
 * {@link deleteWorkspaceFile}.
 */
export async function purgeCreatedWorkspaceFile(params: {
  workspaceId: string
  fileId: string
  key: string
  expectedName: string
  expectedFolderId: string | null
  expectedUpdatedAt: Date
}): Promise<boolean> {
  const storageBillingContext = await resolveStorageBillingContext(params.workspaceId)
  const expectedFolder =
    params.expectedFolderId === null
      ? isNull(workspaceFiles.folderId)
      : eq(workspaceFiles.folderId, params.expectedFolderId)
  /** The full creation identity. Shared so the lock and the delete can never diverge. */
  const matchesCreatedFile = and(
    eq(workspaceFiles.id, params.fileId),
    eq(workspaceFiles.workspaceId, params.workspaceId),
    eq(workspaceFiles.key, params.key),
    eq(workspaceFiles.originalName, params.expectedName),
    expectedFolder,
    eq(workspaceFiles.updatedAt, params.expectedUpdatedAt),
    eq(workspaceFiles.context, 'workspace'),
    isNull(workspaceFiles.deletedAt)
  )
  const cleanupEventId = await db.transaction(async (tx) => {
    const [lockedFile] = await tx
      .select({
        id: workspaceFiles.id,
        key: workspaceFiles.key,
        sizeBytes: workspaceFiles.sizeBytes,
      })
      .from(workspaceFiles)
      .where(matchesCreatedFile)
      .for('update')
      .limit(1)
    if (!lockedFile) return null

    const [deleted] = await tx
      .delete(workspaceFiles)
      .where(matchesCreatedFile)
      .returning({ id: workspaceFiles.id })
    if (!deleted) throw new Error('Locked archive-created file could not be deleted')

    await decrementStorageUsageForBillingContextInTx(
      tx,
      storageBillingContext,
      getWorkspaceFileSize(lockedFile)
    )
    return enqueueWorkspaceFileStorageCleanup(tx, { key: lockedFile.key })
  })
  if (!cleanupEventId) return false

  try {
    const result = await processWorkspaceFileStorageCleanupNow(cleanupEventId)
    if (result !== 'completed') {
      logger.warn('Archive rollback storage cleanup deferred to outbox retry', {
        workspaceId: params.workspaceId,
        fileId: params.fileId,
        cleanupEventId,
        result,
      })
    }
  } catch (error) {
    logger.warn('Archive rollback storage cleanup deferred after inline processing error', {
      workspaceId: params.workspaceId,
      fileId: params.fileId,
      cleanupEventId,
      error: getErrorMessage(error),
    })
  }
  return true
}

/**
 * Restore a soft-deleted workspace file.
 */
export interface PermanentlyDeleteWorkspaceFileResult {
  /** The record as it stood before its row was removed. */
  file: WorkspaceFileRecord
  /**
   * Whether the stored object was removed. `false` means the row is gone but
   * the object outlived it and is now an orphan for the storage sweep, which is
   * a recoverable state; the reverse never happens by construction.
   */
  objectDeleted: boolean
}

export async function restoreWorkspaceFile(workspaceId: string, fileId: string): Promise<void> {
  logger.info(`Restoring workspace file: ${fileId}`)

  const fileRecord = await findWorkspaceFileForLifecycle(db, workspaceId, fileId)
  if (!fileRecord) {
    throw new OrchestrationError('not_found', 'File not found')
  }

  if (!fileRecord.deletedAt) {
    return
  }

  const ws = await getWorkspaceWithOwner(workspaceId)
  if (!ws || ws.archivedAt) {
    throw new OrchestrationError('validation', 'Cannot restore file into an archived workspace')
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
        .returning(workspaceFileColumns)
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
