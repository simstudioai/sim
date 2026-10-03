import { createHash } from 'node:crypto'
import { db } from '@sim/db'
import { outboxEvent } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { deferOutboxHandler, type OutboxHandler } from '@/lib/core/outbox/service'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { PermanentDocumentProcessingError } from '@/lib/knowledge/documents/document-processing-error'
import type { OcrRequestPolicy } from '@/lib/knowledge/documents/ocr-request-policy'
import {
  checkpointIo,
  isMissingCheckpointObject,
} from '@/lib/knowledge/documents/processing-checkpoint-io'
import { getKnowledgeOpaqueModelInputRegistry } from '@/lib/knowledge/model-input-provenance'
import {
  deleteFile,
  downloadFile,
  headObject,
  uploadFile,
} from '@/lib/uploads/core/storage-service'

const logger = createLogger('OcrCheckpoints')
const CHECKPOINT_TTL_MS = 48 * 60 * 60 * 1000
const WRITE_SAFETY_MARGIN_MS = 15 * 60 * 1000
const MAX_HEADER_BYTES = 1024
const MAX_CHECKPOINT_TEXT_BYTES = 20 * 1024 * 1024
const CHECKPOINT_KEY_PATTERN =
  /^knowledge-ocr-checkpoints\/v1\/[a-f0-9]{64}\/\d{1,5}--?\d{1,5}\.txt$/

export const OCR_CHECKPOINT_CLEANUP_OUTBOX_EVENT = 'knowledge.document.ocr-checkpoint.expire'

/** Canonical internal processing identity, never populated from a public request. */
export interface OcrCheckpointContext {
  knowledgeBaseId: string
  documentId: string
  indexingPassId: string
}

interface PageRange {
  startPage: number
  endPage: number
}

interface CheckpointHeader {
  version: 1
  identity: string
  expiresAt: number
  contentHash: string
  startPage: number
  endPage: number
}

interface CheckpointCleanupPayload {
  key: string
  expiresAt: number
}

function hash(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex')
}

function assertTextLimit(content: string, maxBytes: number): void {
  if (Buffer.byteLength(content, 'utf8') > maxBytes) {
    throw new PermanentDocumentProcessingError(
      'document_complexity_limit',
      'OCR extracted more than the safe text limit. Split the document into smaller files and retry.'
    )
  }
}

/**
 * Stores each verified page range separately, so resuming a later provider wait
 * reads each completed range once instead of rewriting a growing text manifest.
 * Source bytes, canonical document/pass identity, model, and split policy all
 * participate in the address. Text is private storage data, never outbox payload.
 */
export function createOcrCheckpoints(options: {
  context: OcrCheckpointContext
  source: Buffer
  providerIdentity: string
  policy: OcrRequestPolicy
}) {
  const { context, source, providerIdentity, policy } = options
  if (!context.knowledgeBaseId || !context.documentId || !context.indexingPassId) {
    throw new Error('OCR checkpoint requires a canonical processing identity')
  }
  const identity = hash(
    JSON.stringify({
      version: 1,
      ...context,
      sourceHash: hash(source),
      providerIdentity,
      maxBytes: policy.maxBytes,
      maxPages: policy.maxPages,
    })
  )

  function keyFor(range: PageRange): string {
    if (
      !Number.isInteger(range.startPage) ||
      !Number.isInteger(range.endPage) ||
      range.startPage < 0 ||
      range.startPage > 9999 ||
      range.endPage < -1 ||
      range.endPage > 9999 ||
      (range.endPage < range.startPage && !(range.startPage === 0 && range.endPage === -1))
    ) {
      throw new Error('OCR checkpoint has an invalid page range')
    }
    return `knowledge-ocr-checkpoints/v1/${identity}/${range.startPage}-${range.endPage}.txt`
  }

  return {
    async load(
      range: PageRange,
      remainingBytes: number,
      signal?: AbortSignal
    ): Promise<string | null> {
      signal?.throwIfAborted()
      getKnowledgeOpaqueModelInputRegistry()
      const key = keyFor(range)
      const stored = await checkpointIo(() => headObject(key, 'knowledge-base'), signal)
      signal?.throwIfAborted()
      if (!stored) return null
      if (stored.size > MAX_CHECKPOINT_TEXT_BYTES + MAX_HEADER_BYTES) {
        logger.warn('Ignoring oversized OCR checkpoint')
        return null
      }
      let encoded: Buffer
      try {
        encoded = await checkpointIo(
          (readSignal) =>
            downloadFile({
              key,
              context: 'knowledge-base',
              maxBytes: MAX_CHECKPOINT_TEXT_BYTES + MAX_HEADER_BYTES,
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
      if (
        !header ||
        typeof header !== 'object' ||
        !('version' in header) ||
        header.version !== 1 ||
        !('identity' in header) ||
        header.identity !== identity ||
        !('startPage' in header) ||
        header.startPage !== range.startPage ||
        !('endPage' in header) ||
        header.endPage !== range.endPage ||
        !('expiresAt' in header) ||
        typeof header.expiresAt !== 'number' ||
        !Number.isFinite(header.expiresAt) ||
        header.expiresAt <= Date.now() ||
        !('contentHash' in header) ||
        typeof header.contentHash !== 'string'
      )
        return null
      const contentBytes = encoded.subarray(separator + 1)
      if (hash(contentBytes) !== header.contentHash) return null
      const content = contentBytes.toString('utf8')
      assertTextLimit(content, Math.min(remainingBytes, MAX_CHECKPOINT_TEXT_BYTES))
      return content
    },

    async save(
      range: PageRange,
      content: string,
      remainingBytes: number,
      signal?: AbortSignal
    ): Promise<void> {
      signal?.throwIfAborted()
      getKnowledgeOpaqueModelInputRegistry()
      assertTextLimit(content, Math.min(remainingBytes, MAX_CHECKPOINT_TEXT_BYTES))
      const key = keyFor(range)
      const cleanupId = `knowledge-ocr-cleanup:${hash(key)}`
      const expiresAt = Date.now() + CHECKPOINT_TTL_MS
      const payload: CheckpointCleanupPayload = { key, expiresAt }
      const inserted = await checkpointIo(
        async () =>
          db
            .insert(outboxEvent)
            .values({
              id: cleanupId,
              eventType: OCR_CHECKPOINT_CLEANUP_OUTBOX_EVENT,
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
      /** An old pass never rewrites an object whose original cleanup is due. */
      if (
        !cleanup ||
        cleanup.status !== 'pending' ||
        cleanup.availableAt.getTime() <= Date.now() + WRITE_SAFETY_MARGIN_MS
      )
        return
      const contentBytes = Buffer.from(content, 'utf8')
      const header: CheckpointHeader = {
        version: 1,
        identity,
        expiresAt: cleanup.availableAt.getTime(),
        contentHash: hash(contentBytes),
        startPage: range.startPage,
        endPage: range.endPage,
      }
      await checkpointIo(
        (writeSignal) =>
          uploadFile({
            file: Buffer.concat([Buffer.from(`${JSON.stringify(header)}\n`), contentBytes]),
            fileName: 'ocr-checkpoint.txt',
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
    },
  }
}

/** Cleanup is durable before an upload starts, including a worker crash mid-write. */
export const cleanupOcrCheckpoint: OutboxHandler = async (payload, context) => {
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('key' in payload) ||
    typeof payload.key !== 'string' ||
    !CHECKPOINT_KEY_PATTERN.test(payload.key) ||
    !('expiresAt' in payload) ||
    typeof payload.expiresAt !== 'number' ||
    !Number.isFinite(payload.expiresAt)
  )
    throw new Error('Invalid OCR checkpoint cleanup payload')
  context.signal.throwIfAborted()
  if (payload.expiresAt > Date.now()) {
    return deferOutboxHandler(
      'OCR checkpoint has not expired',
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
