import { db } from '@sim/db'
import { project, uploadSession } from '@sim/db/schema'
import { describeError } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { and, asc, eq, gt, inArray, isNull, sql } from 'drizzle-orm'
import {
  continueOutboxHandler,
  deferOutboxHandler,
  enqueueOutboxEvent,
  type OutboxEventContext,
  type OutboxHandler,
  type OutboxHandlerRegistry,
} from '@/lib/core/outbox/service'
import type { DbTransaction } from '@/lib/db/types'
import {
  PROJECT_FILE_PREFIX_CLEANUP_EVENT,
  PROJECT_STORAGE_RECONCILE_EVENT,
} from '@/lib/projects/files/outbox-events'
import { isObjectNotFoundError } from '@/lib/uploads/core/errors'
import {
  deleteStorageKeysUnderPrefix,
  listStorageKeyPage,
  outboxDeadlineNear,
  storageCleanupAvailableAt,
} from '@/lib/uploads/core/prefix-sweep'
import { abortProviderUpload } from '@/lib/uploads/upload-session/provider'
import type { UploadSessionRecord } from '@/lib/uploads/upload-session/service'
import { PROJECT_FILE_UPLOAD_BINDING_KEY } from '@/lib/uploads/upload-session/types'

const PAGE_SIZE = 500

type UploadCleanup = Pick<
  UploadSessionRecord,
  'id' | 'method' | 'storageProvider' | 'providerUploadId' | 'finalKey'
>
interface CleanupPayload {
  projectId: string
  uploads?: UploadCleanup[]
  uploadCursor?: number
}

function prefixFor(projectId: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) throw new Error('Invalid Project cleanup identity')
  return `project/${projectId}/`
}

function parsePayload(value: unknown): CleanupPayload {
  if (!isRecordLike(value) || typeof value.projectId !== 'string')
    throw new Error('Invalid Project cleanup payload')
  const prefix = prefixFor(value.projectId)
  const uploadCursor = value.uploadCursor === undefined ? 0 : value.uploadCursor
  if (
    !Number.isSafeInteger(uploadCursor) ||
    typeof uploadCursor !== 'number' ||
    uploadCursor < 0 ||
    uploadCursor > PAGE_SIZE
  )
    throw new Error('Invalid retired upload cursor')
  if (value.uploads === undefined) return { projectId: value.projectId, uploadCursor }
  if (!Array.isArray(value.uploads) || value.uploads.length > PAGE_SIZE)
    throw new Error('Invalid upload cleanup batch')
  const uploads = value.uploads.map((upload): UploadCleanup => {
    if (
      !isRecordLike(upload) ||
      typeof upload.id !== 'string' ||
      !/^[a-zA-Z0-9_-]+$/.test(upload.id) ||
      (upload.method !== 'put' && upload.method !== 'multipart') ||
      (upload.storageProvider !== 'local' &&
        upload.storageProvider !== 's3' &&
        upload.storageProvider !== 'blob' &&
        upload.storageProvider !== 'gcs') ||
      (upload.providerUploadId !== null && typeof upload.providerUploadId !== 'string') ||
      typeof upload.finalKey !== 'string' ||
      !upload.finalKey.startsWith(prefix)
    )
      throw new Error('Invalid retired upload descriptor')
    return {
      id: upload.id,
      method: upload.method,
      storageProvider: upload.storageProvider,
      providerUploadId: upload.providerUploadId,
      finalKey: upload.finalKey,
    }
  })
  return { projectId: value.projectId, uploads, uploadCursor }
}

async function enqueueSweeps(
  executor: Pick<typeof db, 'insert'>,
  payload: CleanupPayload,
  retiredAt = new Date()
) {
  await enqueueOutboxEvent(executor, PROJECT_FILE_PREFIX_CLEANUP_EVENT, payload)
  await enqueueOutboxEvent(executor, PROJECT_FILE_PREFIX_CLEANUP_EVENT, payload, {
    availableAt: storageCleanupAvailableAt(retiredAt),
  })
}

/** Must follow Project and payer locks and precede directory/file locks in the retirement transaction. */
export async function retireProjectUploadsInTx(
  tx: DbTransaction,
  projectId: string
): Promise<void> {
  prefixFor(projectId)
  const now = new Date()
  let afterId = ''
  let queued = false
  for (;;) {
    const rows = await tx
      .select()
      .from(uploadSession)
      .where(
        and(
          eq(uploadSession.purpose, 'project_file'),
          sql`${uploadSession.metadata}->${PROJECT_FILE_UPLOAD_BINDING_KEY}->>'entityId' = ${projectId}`,
          isNull(uploadSession.completedFileId),
          gt(uploadSession.id, afterId)
        )
      )
      .orderBy(asc(uploadSession.id))
      .limit(PAGE_SIZE)
      .for('update')
    if (!rows.length) break
    const uploads = rows.map(
      (row): UploadCleanup => ({
        id: row.id,
        method: row.method,
        storageProvider: row.storageProvider,
        providerUploadId: row.providerUploadId,
        finalKey: row.finalKey,
      })
    )
    parsePayload({ projectId, uploads })
    await tx
      .update(uploadSession)
      .set({
        status: 'aborting',
        expiresAt: now,
        processingLeaseId: null,
        processingLeaseExpiresAt: null,
        updatedAt: now,
      })
      .where(
        inArray(
          uploadSession.id,
          rows.map((row) => row.id)
        )
      )
    await enqueueSweeps(tx, { projectId, uploads }, now)
    queued = true
    afterId = rows[rows.length - 1].id
  }
  if (!queued) await enqueueSweeps(tx, { projectId }, now)
}

/** Late provider responses schedule their own durable sweep after the owner has disappeared. */
export async function queueRetiredProjectUploadCleanup(
  session: UploadSessionRecord
): Promise<boolean> {
  if (session.purpose !== 'project_file') return false
  const binding = session.metadata[PROJECT_FILE_UPLOAD_BINDING_KEY]
  if (!isRecordLike(binding) || typeof binding.entityId !== 'string')
    throw new Error('Invalid Project upload binding')
  const payload = parsePayload({
    projectId: binding.entityId,
    uploads: [
      {
        id: session.id,
        method: session.method,
        storageProvider: session.storageProvider,
        providerUploadId: session.providerUploadId,
        finalKey: session.finalKey,
      },
    ],
  })
  return db.transaction(async (tx) => {
    const [owner] = await tx
      .select({ id: project.id })
      .from(project)
      .where(eq(project.id, payload.projectId))
    if (owner) return false
    await tx
      .update(uploadSession)
      .set({
        status: 'aborting',
        expiresAt: new Date(),
        processingLeaseId: null,
        processingLeaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(uploadSession.id, session.id),
          eq(uploadSession.purpose, 'project_file'),
          eq(uploadSession.finalKey, session.finalKey),
          isNull(uploadSession.completedFileId)
        )
      )
    await enqueueSweeps(tx, payload)
    return true
  })
}

/**
 * Deletes one listing page's objects per run, re-listing from the prefix start next time. A
 * provider (Azure Blob, GCS, S3-compatibles) may return a short or empty page that is not the last,
 * so only `page.done` ends the sweep; a non-final page that removes nothing is followed to the next
 * one within the run, so objects behind it are still reached. `stalled` when no page removed
 * anything before the listing stopped advancing or the deadline neared.
 */
async function sweepPrefix(
  projectId: string,
  context: OutboxEventContext
): Promise<'done' | 'continue' | 'stalled'> {
  const prefix = prefixFor(projectId)
  let pageToken: string | undefined
  for (;;) {
    const page = await listStorageKeyPage(prefix, 'project', context.signal, pageToken)
    const { deleted, complete } = await deleteStorageKeysUnderPrefix(
      prefix,
      'project',
      page.keys,
      context
    )
    if (complete && page.done) return 'done'
    if (deleted > 0) return 'continue'
    const advanced = page.nextPageToken !== undefined && page.nextPageToken !== pageToken
    if (!complete || !advanced || outboxDeadlineNear(context)) return 'stalled'
    pageToken = page.nextPageToken
  }
}

const cleanupPrefix: OutboxHandler<unknown> = async (raw, context) => {
  const payload = parsePayload(raw)
  const [owner] = await db
    .select({ id: project.id })
    .from(project)
    .where(eq(project.id, payload.projectId))
  // Canonical creation always generates fresh Project IDs; an extant owner is never disposable.
  if (owner) throw new Error('Cannot clean storage for an existing Project')
  const uploads = payload.uploads ?? []
  for (let index = payload.uploadCursor ?? 0; index < uploads.length; index++) {
    const upload = uploads[index]
    context.signal.throwIfAborted()
    try {
      await abortProviderUpload({
        provider: upload.storageProvider,
        method: upload.method,
        providerUploadId: upload.providerUploadId,
        uploadId: upload.id,
        key: upload.finalKey,
        context: 'project',
      })
    } catch (error) {
      const details = describeError(error)
      if (
        details.code !== 'NoSuchUpload' &&
        details.name !== 'NoSuchUpload' &&
        !isObjectNotFoundError(error)
      )
        throw error
    }
    if ((index + 1) % 20 === 0 || index === uploads.length - 1)
      await context.checkpointPayload({ uploadCursor: index + 1 })
    if (outboxDeadlineNear(context)) {
      await context.checkpointPayload({ uploadCursor: index + 1 })
      return continueOutboxHandler('Continuing retired Project upload cleanup')
    }
  }
  const sweep = await sweepPrefix(payload.projectId, context)
  if (sweep === 'continue') return continueOutboxHandler('Continuing Project storage cleanup')
  if (sweep === 'stalled')
    return deferOutboxHandler('Project storage cleanup removed nothing from its listing')
}

/**
 * Retained only to drain rows armed by the former bucket inventory. The inventory deleted every
 * `project/<id>/` prefix without a matching row, which is unsafe because this database is not the
 * authority for a bucket shared with another deployment or restored to an earlier point in time.
 */
const drainRetiredStorageInventory: OutboxHandler<unknown> = async () => {}

export const projectFilePrefixCleanupOutboxHandlers = {
  [PROJECT_FILE_PREFIX_CLEANUP_EVENT]: cleanupPrefix,
  [PROJECT_STORAGE_RECONCILE_EVENT]: drainRetiredStorageInventory,
} satisfies OutboxHandlerRegistry
