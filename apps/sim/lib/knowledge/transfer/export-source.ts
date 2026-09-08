import { db } from '@sim/db'
import { document, embedding } from '@sim/db/schema'
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { KbEmbeddingDimensions } from '@/lib/embeddings/catalog'
import { knowledgeAccessCondition } from '@/lib/knowledge/access/predicate'
import { WORKSPACE_ACCESS_SCOPE } from '@/lib/knowledge/access/scope'
import { ALL_TAG_SLOTS, MAX_KNOWLEDGE_BUNDLE_DOCUMENTS } from '@/lib/knowledge/constants'
import { getTagDefinitions } from '@/lib/knowledge/tags/service'
import {
  type ExportableDocumentRecord,
  type KnowledgeBundleChunkLine,
  type KnowledgeBundleTag,
  knowledgeBundleTagSchema,
} from '@/lib/knowledge/transfer/bundle'
import { embeddingVectorColumn } from '@/lib/knowledge/vector-columns'

/**
 * Read side of a knowledge-base export. Chunk reads page by keyset so a large
 * document never materializes at once, and every document read carries
 * {@link knowledgeAccessCondition} for the plain workspace scope: a bundle
 * drops access-control lists, so only what every workspace member can already
 * read may leave.
 */

/** Chunk rows per page. A 3072-wide vector page is ~15 MB on the wire, so vector reads page smaller. */
const CHUNK_PAGE_SIZE = { text: 500, vectors: 100 } as const

/** Where a document's original bytes come from, when it has any. */
export type ExportableFileSource =
  | { kind: 'storage'; key: string }
  | { kind: 'data-uri'; fileUrl: string }

export interface ExportableDocument extends ExportableDocumentRecord {
  file: ExportableFileSource | null
  /** True when the document finished processing and holds chunks worth exporting. */
  hasChunks: boolean
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

function fileSourceFor(row: {
  storageKey: string | null
  fileUrl: string
}): ExportableFileSource | null {
  if (row.storageKey) return { kind: 'storage', key: row.storageKey }
  if (row.fileUrl.startsWith('data:')) return { kind: 'data-uri', fileUrl: row.fileUrl }
  return null
}

/**
 * The base's tag definitions in slot order, validated against the bundle's tag
 * schema: the stored `tagSlot` column type only names the text slots and
 * `fieldType` is free text, so validation is what proves the rows form an
 * importable manifest.
 */
export async function listExportableTags(knowledgeBaseId: string): Promise<KnowledgeBundleTag[]> {
  const definitions = await getTagDefinitions(knowledgeBaseId)
  return knowledgeBundleTagSchema.array().parse(
    definitions.map(({ tagSlot, displayName, fieldType }) => ({
      slot: tagSlot,
      displayName,
      fieldType,
    }))
  )
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
      fileUrl: document.fileUrl,
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
    const file = fileSourceFor(row)
    const hasChunks = row.processingStatus === 'completed' && row.chunkCount > 0
    if (!file && !hasChunks) continue
    documents.push({
      id: row.id,
      filename: row.filename,
      mimeType: row.mimeType,
      fileSize: row.fileSize,
      enabled: row.enabled,
      tokenCount: row.tokenCount,
      characterCount: row.characterCount,
      file,
      hasChunks,
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
