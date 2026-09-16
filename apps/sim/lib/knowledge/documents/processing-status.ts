import { document } from '@sim/db/schema'
import { and, eq, isNotNull, isNull, not, sql } from 'drizzle-orm'
import type { DocumentProcessingOutcome } from '@/lib/knowledge/documents/types'

interface StoredDocumentProcessingState {
  processingStatus: string
  externalId: string | null
  storageKey: string | null
  contentHash: string | null
  fileUrl: string
}

/**
 * Source omissions keep the legacy failed storage state for mixed-version app/worker
 * compatibility. Their immutable source identity and version, with no stored or remote
 * artifact, distinguish them from download failures (no version) and indexing failures
 * (an artifact). Source identity survives disconnecting a connector with documents kept.
 * The additive outcome lets current readers distinguish skips without rewriting old rows.
 */
export function getDocumentProcessingOutcome(
  row: StoredDocumentProcessingState
): DocumentProcessingOutcome {
  if (
    row.processingStatus === 'failed' &&
    row.externalId !== null &&
    row.storageKey === null &&
    row.fileUrl === '' &&
    row.contentHash !== null
  ) {
    return 'skipped'
  }
  return null
}

/** SQL counterpart used for paging and aggregate counts before document rows are loaded. */
export function skippedDocumentCondition() {
  return and(
    eq(document.processingStatus, 'failed'),
    isNotNull(document.externalId),
    isNull(document.storageKey),
    eq(document.fileUrl, ''),
    isNotNull(document.contentHash)
  )!
}

export function failedDocumentCondition() {
  return and(eq(document.processingStatus, 'failed'), not(skippedDocumentCondition()))!
}

export function documentProcessingOutcomeSelection() {
  return sql<DocumentProcessingOutcome>`CASE WHEN ${skippedDocumentCondition()} THEN 'skipped' ELSE NULL END`
}
