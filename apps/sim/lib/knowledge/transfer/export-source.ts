/**
 * Read side of a knowledge-base export. Chunk reads page by keyset so a large
 * document never materializes at once, and the document listing carries
 * {@link knowledgeAccessCondition} for the plain workspace scope: a bundle
 * drops access-control lists, so only what every workspace member can already
 * read may leave. Everything downstream reads by the ids that listing returned.
 */

import { db } from '@sim/db'
import { document, embedding } from '@sim/db/schema'
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { KbEmbeddingDimensions } from '@/lib/embeddings/catalog'
import { knowledgeAccessCondition } from '@/lib/knowledge/access/predicate'
import { WORKSPACE_ACCESS_SCOPE } from '@/lib/knowledge/access/scope'
import {
  ALL_TAG_SLOTS,
  MAX_KNOWLEDGE_BUNDLE_CHUNK_CONTENT_LENGTH,
  MAX_KNOWLEDGE_BUNDLE_DOCUMENTS,
} from '@/lib/knowledge/constants'
import { getTagDefinitions } from '@/lib/knowledge/tags/service'
import type {
  ExportableDocumentRecord,
  KnowledgeBundleChunkLine,
} from '@/lib/knowledge/transfer/bundle'
import { embeddingVectorColumn } from '@/lib/knowledge/vector-columns'

/**
 * Chunk rows per page, sized for chunks of ordinary width. A vector page
 * carries the widest column pgvector holds, so it pages far smaller than a
 * text-only one. Content is bounded by
 * {@link MAX_KNOWLEDGE_BUNDLE_CHUNK_CONTENT_LENGTH} rather than by these counts,
 * so a base of unusually wide chunks pages heavier than the numbers suggest.
 */
const CHUNK_PAGE_SIZE = { text: 500, vectors: 100 } as const

/** Where a document's original bytes come from, when it has any. */
export type ExportableFileSource =
  | { kind: 'storage'; key: string }
  | { kind: 'data-uri'; knowledgeBaseId: string; documentId: string }

export interface ExportableDocument extends ExportableDocumentRecord {
  file: ExportableFileSource | null
  /**
   * Chunks this document contributes, from its denormalized counter, and zero
   * unless processing finished. The bundle gate checks it against the format's
   * per-document ceiling before any byte streams; the archive writes what its
   * chunk stream actually produced, which the archive bounds again.
   */
  storedChunkCount: number
}

/** A chunk as stored, before its vector is encoded for the wire. */
export type ExportableChunk = Omit<KnowledgeBundleChunkLine, 'vector'> & {
  vector: number[] | null
}

function exportableDocumentCondition(knowledgeBaseId: string) {
  return and(
    eq(document.knowledgeBaseId, knowledgeBaseId),
    isNull(document.deletedAt),
    isNull(document.archivedAt),
    eq(document.userExcluded, false),
    knowledgeAccessCondition(WORKSPACE_ACCESS_SCOPE)
  )
}

function fileSourceFor(
  knowledgeBaseId: string,
  row: { id: string; storageKey: string | null; hasInlineFile: boolean }
): ExportableFileSource | null {
  if (row.storageKey) return { kind: 'storage', key: row.storageKey }
  if (row.hasInlineFile) return { kind: 'data-uri', knowledgeBaseId, documentId: row.id }
  return null
}

/** The base's tag definitions in slot order, as stored; the bundle gate validates them. */
export async function listExportableTags(
  knowledgeBaseId: string
): Promise<Array<{ slot: string; displayName: string; fieldType: string }>> {
  const definitions = await getTagDefinitions(knowledgeBaseId)
  return definitions.map(({ tagSlot, displayName, fieldType }) => ({
    slot: tagSlot,
    displayName,
    fieldType,
  }))
}

/**
 * A document's inline `data:` payload, read only when its archive entry is
 * reached: the column can hold megabytes per row, so the listing carries a flag
 * and the archive fetches one payload at a time.
 */
export async function readInlineFileUrl(
  knowledgeBaseId: string,
  documentId: string
): Promise<string> {
  const [row] = await db
    .select({ fileUrl: document.fileUrl })
    .from(document)
    .where(and(eq(document.knowledgeBaseId, knowledgeBaseId), eq(document.id, documentId)))
    .limit(1)
  if (!row) throw new OrchestrationError('not_found', 'Document not found')
  return row.fileUrl
}

/**
 * Every document the bundle will carry, in id order. Reads one row past
 * {@link MAX_KNOWLEDGE_BUNDLE_DOCUMENTS} and refuses the base when it is there,
 * so no export ever produces a bundle an import would refuse. Documents with
 * neither a file nor chunks are dropped, since the manifest cannot describe them.
 */
export async function listExportableDocuments(
  knowledgeBaseId: string
): Promise<ExportableDocument[]> {
  const rows = await db
    .select({
      id: document.id,
      filename: document.filename,
      mimeType: document.mimeType,
      fileSize: document.fileSize,
      enabled: document.enabled,
      storageKey: document.storageKey,
      hasInlineFile: sql<boolean>`left(${document.fileUrl}, 5) = 'data:'`,
      processingStatus: document.processingStatus,
      chunkCount: document.chunkCount,
      tokenCount: document.tokenCount,
      characterCount: document.characterCount,
      tag1: document.tag1,
      tag2: document.tag2,
      tag3: document.tag3,
      tag4: document.tag4,
      tag5: document.tag5,
      tag6: document.tag6,
      tag7: document.tag7,
      number1: document.number1,
      number2: document.number2,
      number3: document.number3,
      number4: document.number4,
      number5: document.number5,
      date1: document.date1,
      date2: document.date2,
      boolean1: document.boolean1,
      boolean2: document.boolean2,
      boolean3: document.boolean3,
    })
    .from(document)
    .where(exportableDocumentCondition(knowledgeBaseId))
    .orderBy(asc(document.id))
    .limit(MAX_KNOWLEDGE_BUNDLE_DOCUMENTS + 1)
  if (rows.length > MAX_KNOWLEDGE_BUNDLE_DOCUMENTS) {
    throw new OrchestrationError(
      'payload_too_large',
      `Knowledge base has more than ${MAX_KNOWLEDGE_BUNDLE_DOCUMENTS} documents, the most an export carries`
    )
  }

  const documents: ExportableDocument[] = []
  for (const row of rows) {
    const file = fileSourceFor(knowledgeBaseId, row)
    const storedChunkCount = row.processingStatus === 'completed' ? row.chunkCount : 0
    if (!file && storedChunkCount === 0) continue
    documents.push({
      id: row.id,
      filename: row.filename,
      mimeType: row.mimeType,
      fileSize: row.fileSize,
      enabled: row.enabled,
      tokenCount: row.tokenCount,
      characterCount: row.characterCount,
      file,
      storedChunkCount,
      tags: Object.fromEntries(ALL_TAG_SLOTS.map((slot) => [slot, row[slot]])),
    })
  }
  return documents
}

/**
 * A document's chunks in chunk-index order, one page at a time. The vector column is
 * read only when `dimensions` is given, so a text-only export never pulls the
 * widest column off disk. `(documentId, chunkIndex)` is unique, so the index
 * alone is the keyset and each page is one index range scan.
 */
export async function* iterateDocumentChunks(
  knowledgeBaseId: string,
  documentId: string,
  dimensions: KbEmbeddingDimensions | null
): AsyncGenerator<ExportableChunk> {
  const pageSize = dimensions ? CHUNK_PAGE_SIZE.vectors : CHUNK_PAGE_SIZE.text
  let after: number | null = null
  for (;;) {
    const page = await db
      .select({
        index: embedding.chunkIndex,
        content: embedding.content,
        tokenCount: embedding.tokenCount,
        startOffset: embedding.startOffset,
        endOffset: embedding.endOffset,
        enabled: embedding.enabled,
        vector: dimensions ? embeddingVectorColumn(dimensions) : sql<null>`null`,
      })
      .from(embedding)
      .where(
        and(
          eq(embedding.knowledgeBaseId, knowledgeBaseId),
          eq(embedding.documentId, documentId),
          after === null ? undefined : gt(embedding.chunkIndex, after)
        )
      )
      .orderBy(asc(embedding.chunkIndex))
      .limit(pageSize)

    yield* page
    if (page.length < pageSize) break
    after = page[page.length - 1].index
  }
}
