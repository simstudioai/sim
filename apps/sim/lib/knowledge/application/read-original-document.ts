import type { Principal } from '@sim/auth/principal'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { hashDurableSecretProvenanceValue } from '@/lib/execution/durable-secret-provenance'
import { decodeDataUriWithinLimit } from '@/lib/file-parsers/data-uri'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import { resolveCanonicalActiveKnowledgeDocumentContext } from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import {
  createKnowledgeDocumentSourceValue,
  loadKnowledgeDocumentDurableSecretProvenance,
} from '@/lib/knowledge/secret-provenance'
import { isObjectNotFoundError } from '@/lib/uploads/core/errors'
import { downloadFile } from '@/lib/uploads/core/storage-service'
import { MAX_TEXT_EXTRACTION_BYTES } from '@/lib/uploads/utils/file-utils'

export interface ReadOriginalKnowledgeDocumentInput {
  knowledgeBaseId: string
  documentId: string
  assertedWorkspaceId: string
  maxBytes?: number
  signal?: AbortSignal
}

/** Reads one authorized original without requiring indexing, fetching URLs, or creating a file. */
export const readOriginalKnowledgeDocument = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.readDocument,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: ReadOriginalKnowledgeDocumentInput
  }) => resolveCanonicalActiveKnowledgeDocumentContext(input, principal),
  async execute({ input, context }) {
    const maxBytes = input.maxBytes ?? MAX_TEXT_EXTRACTION_BYTES
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_TEXT_EXTRACTION_BYTES)
      throw new OrchestrationError('validation', 'Invalid document read byte limit')
    input.signal?.throwIfAborted()
    const doc = context.document
    const metadata = {
      documentId: doc.id,
      knowledgeBaseId: context.knowledgeBaseId,
      name: doc.filename,
      contentType: doc.mimeType,
      processingStatus: doc.processingStatus,
      indexReady: doc.enabled && doc.processingStatus === 'completed',
    }
    const unavailable = { ...metadata, sourceAvailable: false as const, buffer: undefined }
    if (doc.fileSize > maxBytes)
      throw new OrchestrationError(
        'payload_too_large',
        'Document exceeds the source read byte limit'
      )
    const snapshot = await loadKnowledgeDocumentDurableSecretProvenance(doc.id)
    if (
      hashDurableSecretProvenanceValue(snapshot.source) !==
        hashDurableSecretProvenanceValue(createKnowledgeDocumentSourceValue(doc)) ||
      snapshot.provenance.status !== 'exact' ||
      snapshot.provenance.entries.length !== 0
    ) {
      throw new OrchestrationError(
        'forbidden',
        'This document has no verified secret-free original. Read its projected indexed passages instead.'
      )
    }
    if (!doc.storageKey && !doc.fileUrl.startsWith('data:')) return unavailable
    let buffer: Buffer
    try {
      buffer = doc.storageKey
        ? await downloadFile({
            key: doc.storageKey,
            context: 'knowledge-base',
            maxBytes,
            signal: input.signal,
          })
        : decodeDataUriWithinLimit(doc.fileUrl, maxBytes).buffer
    } catch (error) {
      input.signal?.throwIfAborted()
      if (
        isObjectNotFoundError(error) ||
        (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      )
        return unavailable
      throw error
    }
    input.signal?.throwIfAborted()
    return { ...metadata, sourceAvailable: true as const, buffer }
  },
})
