import { db } from '@sim/db'
import { outboxEvent } from '@sim/db/schema'
import { sha256Hex } from '@sim/security/hash'
import { isRecordLike } from '@sim/utils/object'
import { eq } from 'drizzle-orm'
import { deferOutboxHandler, type OutboxHandler } from '@/lib/core/outbox/service'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import {
  checkpointIo,
  isMissingCheckpointObject,
} from '@/lib/knowledge/documents/processing-checkpoint-io'
import {
  deleteFile,
  downloadFile,
  headObject,
  uploadFile,
} from '@/lib/uploads/core/storage-service'

/** How long a processing checkpoint outlives the pass that wrote it. */
const PROCESSING_CHECKPOINT_TTL_MS = 48 * 60 * 60 * 1000
/** An old pass never rewrites an object whose cleanup is due within this margin. */
const WRITE_SAFETY_MARGIN_MS = 15 * 60 * 1000
const MAX_HEADER_BYTES = 1024

/**
 * Header fields every checkpoint carries; each kind adds its own identity fields,
 * which its reader verifies against the request it is resuming.
 */
interface FramedCheckpointHeader {
  version: 1
  expiresAt: number
  contentHash: string
}

interface CheckpointCleanupPayload {
  key: string
  expiresAt: number
}

/**
 * Reads a checkpoint written by {@link writeFramedCheckpoint}: one JSON header
 * line, then the body. Returns `null` for anything missing, oversized, expired
 * or corrupt, which callers treat as "call the provider again".
 */
export async function readFramedCheckpoint(
  key: string,
  options: { maxBodyBytes: number; signal?: AbortSignal }
): Promise<{ header: Record<string, unknown>; body: Buffer } | null> {
  const { maxBodyBytes, signal } = options
  signal?.throwIfAborted()
  const stored = await checkpointIo(() => headObject(key, 'knowledge-base'), signal)
  signal?.throwIfAborted()
  if (!stored || stored.size > maxBodyBytes + MAX_HEADER_BYTES) return null
  let encoded: Buffer
  try {
    encoded = await checkpointIo(
      (readSignal) =>
        downloadFile({
          key,
          context: 'knowledge-base',
          maxBytes: maxBodyBytes + MAX_HEADER_BYTES,
          signal: readSignal,
        }),
      signal
    )
  } catch (error) {
    signal?.throwIfAborted()
    if (isMissingCheckpointObject(error) || isPayloadSizeLimitError(error)) return null
    throw error
  }
  signal?.throwIfAborted()
  const separator = encoded.indexOf(10)
  if (separator < 0 || separator > MAX_HEADER_BYTES) return null
  let header: unknown
  try {
    header = JSON.parse(encoded.subarray(0, separator).toString('utf8'))
  } catch {
    return null
  }
  if (!isRecordLike(header)) return null
  const body = encoded.subarray(separator + 1)
  if (
    header.version !== 1 ||
    typeof header.expiresAt !== 'number' ||
    !Number.isFinite(header.expiresAt) ||
    header.expiresAt <= Date.now() ||
    header.contentHash !== sha256Hex(body)
  )
    return null
  return { header, body }
}

/**
 * Writes a checkpoint whose cleanup is durable before the upload starts, so a
 * worker that crashes mid-write cannot orphan the object. The cleanup row is
 * keyed by the object key, so every pass writing the same key shares one expiry.
 */
export async function writeFramedCheckpoint(
  key: string,
  identityHeader: Record<string, unknown>,
  body: Buffer,
  options: {
    cleanupEventType: string
    cleanupIdPrefix: string
    fileName: string
    signal?: AbortSignal
  }
): Promise<void> {
  const { cleanupEventType, cleanupIdPrefix, fileName, signal } = options
  signal?.throwIfAborted()
  const cleanupId = `${cleanupIdPrefix}:${sha256Hex(key)}`
  const expiresAt = Date.now() + PROCESSING_CHECKPOINT_TTL_MS
  const payload: CheckpointCleanupPayload = { key, expiresAt }
  const inserted = await checkpointIo(
    async () =>
      db
        .insert(outboxEvent)
        .values({
          id: cleanupId,
          eventType: cleanupEventType,
          payload,
          availableAt: new Date(expiresAt),
        })
        .onConflictDoNothing({ target: outboxEvent.id })
        .returning({ availableAt: outboxEvent.availableAt, status: outboxEvent.status }),
    signal
  )
  const [cleanup] =
    inserted.length > 0
      ? inserted
      : await checkpointIo(
          async () =>
            db
              .select({ availableAt: outboxEvent.availableAt, status: outboxEvent.status })
              .from(outboxEvent)
              .where(eq(outboxEvent.id, cleanupId))
              .limit(1),
          signal
        )
  signal?.throwIfAborted()
  if (
    !cleanup ||
    cleanup.status !== 'pending' ||
    cleanup.availableAt.getTime() <= Date.now() + WRITE_SAFETY_MARGIN_MS
  )
    return
  const header: FramedCheckpointHeader & Record<string, unknown> = {
    ...identityHeader,
    version: 1,
    expiresAt: cleanup.availableAt.getTime(),
    contentHash: sha256Hex(body),
  }
  await checkpointIo(
    (writeSignal) =>
      uploadFile({
        file: Buffer.concat([Buffer.from(`${JSON.stringify(header)}\n`), body]),
        fileName,
        contentType: 'application/octet-stream',
        context: 'knowledge-base',
        customKey: key,
        preserveKey: true,
        persistMetadata: false,
        signal: writeSignal,
      }),
    signal
  )
  signal?.throwIfAborted()
}

/**
 * Builds the outbox handler that deletes one kind of checkpoint at its expiry.
 * The key pattern keeps a forged payload from deleting anything else.
 */
export function createCheckpointCleanupHandler(options: {
  keyPattern: RegExp
  label: string
}): OutboxHandler {
  const { keyPattern, label } = options
  return async (payload, context) => {
    if (
      !isRecordLike(payload) ||
      typeof payload.key !== 'string' ||
      !keyPattern.test(payload.key) ||
      typeof payload.expiresAt !== 'number' ||
      !Number.isFinite(payload.expiresAt)
    )
      throw new Error(`Invalid ${label} checkpoint cleanup payload`)
    context.signal.throwIfAborted()
    if (payload.expiresAt > Date.now()) {
      return deferOutboxHandler(
        `${label} checkpoint has not expired`,
        payload.expiresAt - Date.now(),
        false
      )
    }
    const key = payload.key
    try {
      await checkpointIo(
        (signal) => deleteFile({ key, context: 'knowledge-base', signal }),
        context.signal
      )
    } catch (error) {
      if (!isMissingCheckpointObject(error)) throw error
    }
  }
}
