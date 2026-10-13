import { sha256Hex } from '@sim/security/hash'
import type { OutboxHandler } from '@/lib/core/outbox/service'
import { OCR_CHECKPOINT_CLEANUP_OUTBOX_EVENT } from '@/lib/knowledge/documents/checkpoint-events'
import { PermanentDocumentProcessingError } from '@/lib/knowledge/documents/document-processing-error'
import type { OcrRequestPolicy } from '@/lib/knowledge/documents/ocr-request-policy'
import {
  createCheckpointCleanupHandler,
  readFramedCheckpoint,
  writeFramedCheckpoint,
} from '@/lib/knowledge/documents/processing-checkpoint-store'
import { getKnowledgeOpaqueModelInputRegistry } from '@/lib/knowledge/model-input-provenance'

const MAX_CHECKPOINT_TEXT_BYTES = 20 * 1024 * 1024
const CHECKPOINT_KEY_PATTERN =
  /^knowledge-ocr-checkpoints\/v1\/[a-f0-9]{64}\/\d{1,5}--?\d{1,5}\.txt$/

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
  const identity = sha256Hex(
    JSON.stringify({
      version: 1,
      ...context,
      sourceHash: sha256Hex(source),
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
      getKnowledgeOpaqueModelInputRegistry()
      const stored = await readFramedCheckpoint(keyFor(range), {
        maxBodyBytes: MAX_CHECKPOINT_TEXT_BYTES,
        signal,
      })
      if (!stored) return null
      const { header, body } = stored
      if (
        header.identity !== identity ||
        header.startPage !== range.startPage ||
        header.endPage !== range.endPage
      )
        return null
      const content = body.toString('utf8')
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
      await writeFramedCheckpoint(
        keyFor(range),
        { identity, startPage: range.startPage, endPage: range.endPage },
        Buffer.from(content, 'utf8'),
        {
          cleanupEventType: OCR_CHECKPOINT_CLEANUP_OUTBOX_EVENT,
          cleanupIdPrefix: 'knowledge-ocr-cleanup',
          fileName: 'ocr-checkpoint.txt',
          signal,
        }
      )
    },
  }
}

/** Cleanup is durable before an upload starts, including a worker crash mid-write. */
export const cleanupOcrCheckpoint: OutboxHandler = createCheckpointCleanupHandler({
  keyPattern: CHECKPOINT_KEY_PATTERN,
  label: 'OCR',
})
