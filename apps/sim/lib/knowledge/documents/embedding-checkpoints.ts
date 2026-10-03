import { db } from '@sim/db'
import { outboxEvent } from '@sim/db/schema'
import { sha256Hex } from '@sim/security/hash'
import { eq } from 'drizzle-orm'
import { deferOutboxHandler, type OutboxHandler } from '@/lib/core/outbox/service'
import { ProviderCapacityDeferredError } from '@/lib/core/rate-limiter/provider-capacity-error'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { EMBEDDING_RETRY_BUDGET_MS } from '@/lib/embeddings/client'
import type { EmbeddingBatchCheckpoints, EmbeddingBatchIdentity } from '@/lib/embeddings/types'
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

const TTL_MS = 48 * 60 * 60 * 1000
const MAX_HEADER_BYTES = 1024
const MAX_VECTOR_BYTES = 16 * 1024 * 1024
const CLEANUP_WRITE_MARGIN_MS = 15 * 60 * 1000
const KEY_PATTERN = /^knowledge-embedding-checkpoints\/v1\/[a-f0-9]{64}\/[a-f0-9]{64}\.bin$/
export const EMBEDDING_CHECKPOINT_CLEANUP_EVENT = 'knowledge.document.embedding-checkpoint.expire'

interface CheckpointHeader {
  version: 1
  key: string
  expiresAt: number
  itemCount: number
  dimensions: number
  totalTokens: number
  contentHash: string
}

function vectorBytes(identity: EmbeddingBatchIdentity): number {
  if (
    !/^[a-f0-9]{64}$/.test(identity.key) ||
    !Number.isInteger(identity.itemCount) ||
    identity.itemCount < 1 ||
    !Number.isInteger(identity.dimensions) ||
    identity.dimensions < 1 ||
    identity.dimensions > 3072 ||
    identity.itemCount * identity.dimensions * 8 > MAX_VECTOR_BYTES
  )
    throw new Error('Invalid embedding checkpoint batch identity')
  return identity.itemCount * identity.dimensions * 8
}

/**
 * Private, bounded binary vectors survive provider waits without staging a partial search index.
 * Only content/request hashes and an expiry enter cleanup jobs. Every reuse still performs current
 * input projection, provider resolution, usage admission, and the document ownership checks.
 */
export function createEmbeddingCheckpoints(options: {
  knowledgeBaseId: string
  documentId: string
  indexingPassId: string
  sourceHash: string
  batchOffset: number
  deadlineAt: number
}): EmbeddingBatchCheckpoints {
  if (
    !options.knowledgeBaseId ||
    !options.documentId ||
    !options.indexingPassId ||
    !/^[a-f0-9]{64}$/.test(options.sourceHash) ||
    !Number.isInteger(options.batchOffset) ||
    options.batchOffset < 0
  ) {
    throw new Error('Embedding checkpoint requires a canonical processing identity')
  }
  const { deadlineAt, ...scope } = options
  const scopeHash = sha256Hex(JSON.stringify(scope))
  const keyFor = (identity: EmbeddingBatchIdentity) =>
    `knowledge-embedding-checkpoints/v1/${scopeHash}/${identity.key}.bin`
  return {
    beforeRequest() {
      /** Reserve the complete retry budget, a checkpoint write and the atomic index swap. */
      if (Date.now() + EMBEDDING_RETRY_BUDGET_MS + 75_000 >= deadlineAt) {
        throw new ProviderCapacityDeferredError('processing_budget', { retryAfterMs: 1000 })
      }
    },
    async load(identity, signal) {
      signal?.throwIfAborted()
      const size = vectorBytes(identity)
      const key = keyFor(identity)
      const metadata = await checkpointIo(() => headObject(key, 'knowledge-base'), signal)
      if (!metadata || metadata.size > size + MAX_HEADER_BYTES) return null
      let encoded: Buffer
      try {
        encoded = await checkpointIo(
          (readSignal) =>
            downloadFile({
              key,
              context: 'knowledge-base',
              maxBytes: size + MAX_HEADER_BYTES,
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
      if (separator < 0 || separator > MAX_HEADER_BYTES || encoded.length - separator - 1 !== size)
        return null
      let header: Partial<CheckpointHeader>
      try {
        const parsed: unknown = JSON.parse(encoded.subarray(0, separator).toString('utf8'))
        if (!parsed || typeof parsed !== 'object') return null
        header = parsed
      } catch {
        return null
      }
      const bytes = encoded.subarray(separator + 1)
      if (
        header.version !== 1 ||
        header.key !== identity.key ||
        header.itemCount !== identity.itemCount ||
        header.dimensions !== identity.dimensions ||
        typeof header.expiresAt !== 'number' ||
        !Number.isFinite(header.expiresAt) ||
        header.expiresAt <= Date.now() ||
        typeof header.totalTokens !== 'number' ||
        !Number.isSafeInteger(header.totalTokens) ||
        header.totalTokens < 0 ||
        header.contentHash !== sha256Hex(bytes)
      )
        return null
      const embeddings: number[][] = []
      let offset = 0
      for (let i = 0; i < identity.itemCount; i++) {
        const vector = new Array<number>(identity.dimensions)
        for (let j = 0; j < identity.dimensions; j++) {
          const value = bytes.readDoubleLE(offset)
          if (!Number.isFinite(value)) return null
          vector[j] = value
          offset += 8
        }
        embeddings.push(vector)
      }
      return { embeddings, totalTokens: header.totalTokens, dimensions: identity.dimensions }
    },
    async save(identity, result, signal) {
      signal?.throwIfAborted()
      const size = vectorBytes(identity)
      if (
        result.embeddings.length !== identity.itemCount ||
        result.dimensions !== identity.dimensions ||
        !Number.isSafeInteger(result.totalTokens) ||
        result.totalTokens < 0
      )
        throw new Error('Invalid embedding checkpoint result')
      const content = Buffer.allocUnsafe(size)
      let offset = 0
      for (const vector of result.embeddings) {
        if (vector.length !== identity.dimensions)
          throw new Error('Invalid embedding checkpoint dimensions')
        for (const value of vector) {
          if (!Number.isFinite(value)) throw new Error('Invalid embedding checkpoint coordinate')
          content.writeDoubleLE(value, offset)
          offset += 8
        }
      }
      const key = keyFor(identity)
      const id = `knowledge-embedding-cleanup:${sha256Hex(key)}`
      const expiresAt = Date.now() + TTL_MS
      const inserted = await checkpointIo(
        async () =>
          db
            .insert(outboxEvent)
            .values({
              id,
              eventType: EMBEDDING_CHECKPOINT_CLEANUP_EVENT,
              payload: { key, expiresAt },
              availableAt: new Date(expiresAt),
            })
            .onConflictDoNothing({ target: outboxEvent.id })
            .returning({ availableAt: outboxEvent.availableAt, status: outboxEvent.status }),
        signal
      )
      const [cleanup] = inserted.length
        ? inserted
        : await checkpointIo(
            async () =>
              db
                .select({
                  availableAt: outboxEvent.availableAt,
                  status: outboxEvent.status,
                })
                .from(outboxEvent)
                .where(eq(outboxEvent.id, id))
                .limit(1),
            signal
          )
      signal?.throwIfAborted()
      if (
        !cleanup ||
        cleanup.status !== 'pending' ||
        cleanup.availableAt.getTime() <= Date.now() + CLEANUP_WRITE_MARGIN_MS
      )
        return
      const header: CheckpointHeader = {
        version: 1,
        key: identity.key,
        expiresAt: cleanup.availableAt.getTime(),
        itemCount: identity.itemCount,
        dimensions: identity.dimensions,
        totalTokens: result.totalTokens,
        contentHash: sha256Hex(content),
      }
      await checkpointIo(
        (writeSignal) =>
          uploadFile({
            file: Buffer.concat([Buffer.from(`${JSON.stringify(header)}\n`), content]),
            fileName: 'embedding-checkpoint.bin',
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

/** Cleanup exists before the first upload so a crashed attempt cannot orphan vectors. */
export const cleanupEmbeddingCheckpoint: OutboxHandler = async (payload, context) => {
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('key' in payload) ||
    typeof payload.key !== 'string' ||
    !KEY_PATTERN.test(payload.key) ||
    !('expiresAt' in payload) ||
    typeof payload.expiresAt !== 'number' ||
    !Number.isFinite(payload.expiresAt)
  )
    throw new Error('Invalid embedding checkpoint cleanup payload')
  context.signal.throwIfAborted()
  if (payload.expiresAt > Date.now())
    return deferOutboxHandler(
      'Embedding checkpoint has not expired',
      payload.expiresAt - Date.now(),
      false
    )
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
