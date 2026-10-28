import { sha256Hex } from '@sim/security/hash'
import type { OutboxHandler } from '@/lib/core/outbox/service'
import { ProviderCapacityDeferredError } from '@/lib/core/rate-limiter/provider-capacity-error'
import { EMBEDDING_RETRY_BUDGET_MS } from '@/lib/embeddings/client'
import type { EmbeddingBatchCheckpoints, EmbeddingBatchIdentity } from '@/lib/embeddings/types'
import { EMBEDDING_CHECKPOINT_CLEANUP_EVENT } from '@/lib/knowledge/documents/checkpoint-events'
import {
  createCheckpointCleanupHandler,
  readFramedCheckpoint,
  writeFramedCheckpoint,
} from '@/lib/knowledge/documents/processing-checkpoint-store'

const MAX_VECTOR_BYTES = 16 * 1024 * 1024
const KEY_PATTERN = /^knowledge-embedding-checkpoints\/v1\/[a-f0-9]{64}\/[a-f0-9]{64}\.bin$/

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
      const size = vectorBytes(identity)
      const stored = await readFramedCheckpoint(keyFor(identity), { maxBodyBytes: size, signal })
      if (!stored || stored.body.length !== size) return null
      const { header, body: bytes } = stored
      if (
        header.key !== identity.key ||
        header.itemCount !== identity.itemCount ||
        header.dimensions !== identity.dimensions ||
        typeof header.totalTokens !== 'number' ||
        !Number.isSafeInteger(header.totalTokens) ||
        header.totalTokens < 0
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
      await writeFramedCheckpoint(
        keyFor(identity),
        {
          key: identity.key,
          itemCount: identity.itemCount,
          dimensions: identity.dimensions,
          totalTokens: result.totalTokens,
        },
        content,
        {
          cleanupEventType: EMBEDDING_CHECKPOINT_CLEANUP_EVENT,
          cleanupIdPrefix: 'knowledge-embedding-cleanup',
          fileName: 'embedding-checkpoint.bin',
          signal,
        }
      )
    },
  }
}

/** Cleanup exists before the first upload so a crashed attempt cannot orphan vectors. */
export const cleanupEmbeddingCheckpoint: OutboxHandler = createCheckpointCleanupHandler({
  keyPattern: KEY_PATTERN,
  label: 'Embedding',
})
