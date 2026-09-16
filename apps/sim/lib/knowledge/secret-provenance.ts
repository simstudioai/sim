import { db } from '@sim/db'
import {
  document,
  documentSecretProvenance,
  embedding,
  embeddingSecretProvenance,
} from '@sim/db/schema'
import { sha256Hex } from '@sim/security/hash'
import { and, eq, inArray, isNull, type SQL } from 'drizzle-orm'
import type { DbTransaction } from '@/lib/db/types'
import {
  bindDurableSecretProvenanceToValue,
  type DurableSecretProvenance,
  EXACT_EMPTY_DURABLE_SECRET_PROVENANCE,
  filterDurableSecretProvenanceBySourceValues,
  hashDurableSecretProvenanceValue,
  importDurableSecretProvenance,
  mergeDurableSecretProvenance,
  normalizeDurableSecretProvenanceEntries,
} from '@/lib/execution/durable-secret-provenance'
import {
  isDurableSecretProvenanceEnforced,
  reportDurableSecretProvenanceRefusal,
  reportDurableSecretProvenanceWrite,
  reportUnrecordedDurableProvenance,
} from '@/lib/execution/durable-secret-provenance-enforcement'
import {
  ResolvedSecretTraceRegistry,
  type ResolvedSecretTraceScopeV1,
} from '@/executor/utils/resolved-secret-trace-registry'

export interface KnowledgeDocumentSourceValue {
  filename: string
  fileUrl: string
  contentHash: string | null
  sourceUrl: string | null
  tag1: string | null
  tag2: string | null
  tag3: string | null
  tag4: string | null
  tag5: string | null
  tag6: string | null
  tag7: string | null
  number1: number | null
  number2: number | null
  number3: number | null
  number4: number | null
  number5: number | null
  date1: string | null
  date2: string | null
  boolean1: boolean | null
  boolean2: boolean | null
  boolean3: boolean | null
}

export interface KnowledgeDocumentWriteSecretProvenance {
  filename: DurableSecretProvenance
  content: DurableSecretProvenance
  tags: readonly {
    tagName: string
    provenance: DurableSecretProvenance
  }[]
}

export type KnowledgeDocumentMetadataField = Exclude<
  keyof KnowledgeDocumentSourceValue,
  'fileUrl' | 'contentHash'
>

const KNOWLEDGE_DOCUMENT_METADATA_FIELDS: readonly KnowledgeDocumentMetadataField[] = [
  'filename',
  'sourceUrl',
  'tag1',
  'tag2',
  'tag3',
  'tag4',
  'tag5',
  'tag6',
  'tag7',
  'number1',
  'number2',
  'number3',
  'number4',
  'number5',
  'date1',
  'date2',
  'boolean1',
  'boolean2',
  'boolean3',
]

function normalizeKnowledgeDocumentDate(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString()
}

/** Creates a field-identified binding so equal bytes in unrelated fields never share provenance. */
function createKnowledgeDocumentFieldBinding(
  field: KnowledgeDocumentMetadataField | 'content',
  value: unknown
): { field: KnowledgeDocumentMetadataField | 'content'; value: unknown } {
  return { field, value }
}

/** Binds one exact input classification to the persisted field it causally produced. */
export function bindKnowledgeDocumentFieldSecretProvenance(
  provenance: DurableSecretProvenance,
  field: KnowledgeDocumentMetadataField | 'content',
  value: unknown
): DurableSecretProvenance {
  return bindDurableSecretProvenanceToValue(
    provenance,
    createKnowledgeDocumentFieldBinding(field, value)
  )
}

/** Selects only provenance belonging to the requested persisted metadata fields. */
function filterKnowledgeDocumentMetadataSecretProvenance(
  provenance: DurableSecretProvenance,
  source: KnowledgeDocumentSourceValue,
  fields: readonly KnowledgeDocumentMetadataField[] = KNOWLEDGE_DOCUMENT_METADATA_FIELDS
): DurableSecretProvenance {
  return filterDurableSecretProvenanceBySourceValues(
    provenance,
    fields.map((field) => createKnowledgeDocumentFieldBinding(field, source[field]))
  )
}

/** Selects only provenance belonging to the persisted document bytes used for processing. */
function filterKnowledgeDocumentContentSecretProvenance(
  provenance: DurableSecretProvenance,
  source: KnowledgeDocumentSourceValue
): DurableSecretProvenance {
  return filterDurableSecretProvenanceBySourceValues(provenance, [
    createKnowledgeDocumentFieldBinding('content', {
      fileUrl: source.fileUrl,
      contentHash: source.contentHash,
    }),
  ])
}

/** Rebinds field-scoped provenance after a metadata edit or byte-identical document copy. */
export function rebindKnowledgeDocumentSecretProvenance(
  provenance: DurableSecretProvenance,
  previousSource: KnowledgeDocumentSourceValue,
  nextSource: KnowledgeDocumentSourceValue
): DurableSecretProvenance {
  if (provenance.status === 'unknown') return provenance
  if (provenance.entries.some((entry) => !entry.sourceValueHash)) return { status: 'unknown' }
  const rebound = KNOWLEDGE_DOCUMENT_METADATA_FIELDS.map((field) =>
    bindKnowledgeDocumentFieldSecretProvenance(
      filterDurableSecretProvenanceBySourceValues(provenance, [
        createKnowledgeDocumentFieldBinding(field, previousSource[field]),
      ]),
      field,
      nextSource[field]
    )
  )
  rebound.push(
    bindKnowledgeDocumentFieldSecretProvenance(
      filterKnowledgeDocumentContentSecretProvenance(provenance, previousSource),
      'content',
      { fileUrl: nextSource.fileUrl, contentHash: nextSource.contentHash }
    )
  )
  return mergeDurableSecretProvenance(...rebound)
}

interface KnowledgeDocumentSecretProvenanceRow {
  secretProvenanceVersion: number | null
  source: KnowledgeDocumentSourceValue
  provenanceSourceHash: string | null
  status: string | null
  entries: unknown
}

interface KnowledgeEmbeddingSecretProvenanceRow {
  secretProvenanceVersion: number | null
  content: string
  chunkHash: string
  provenanceContentHash: string | null
  status: string | null
  entries: unknown
}

const KNOWLEDGE_DOCUMENT_PROVENANCE_SELECTION = {
  id: document.id,
  secretProvenanceVersion: document.secretProvenanceVersion,
  filename: document.filename,
  fileUrl: document.fileUrl,
  contentHash: document.contentHash,
  sourceUrl: document.sourceUrl,
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
  provenanceSourceHash: documentSecretProvenance.sourceHash,
  status: documentSecretProvenance.status,
  entries: documentSecretProvenance.entries,
}

const KNOWLEDGE_EMBEDDING_PROVENANCE_SELECTION = {
  id: embedding.id,
  documentId: embedding.documentId,
  content: embedding.content,
  chunkHash: embedding.chunkHash,
  secretProvenanceVersion: embedding.secretProvenanceVersion,
  provenanceContentHash: embeddingSecretProvenance.contentHash,
  status: embeddingSecretProvenance.status,
  entries: embeddingSecretProvenance.entries,
}

function selectKnowledgeDocumentProvenanceRows(where: SQL<unknown> | undefined) {
  return db
    .select(KNOWLEDGE_DOCUMENT_PROVENANCE_SELECTION)
    .from(document)
    .leftJoin(documentSecretProvenance, eq(documentSecretProvenance.documentId, document.id))
    .where(where)
}

function selectKnowledgeEmbeddingProvenanceRows(where: SQL<unknown> | undefined) {
  return db
    .select(KNOWLEDGE_EMBEDDING_PROVENANCE_SELECTION)
    .from(embedding)
    .leftJoin(embeddingSecretProvenance, eq(embeddingSecretProvenance.embeddingId, embedding.id))
    .where(where)
}

/** Creates the fixed-order source value used by both document writes and freshness checks. */
export function createKnowledgeDocumentSourceValue(
  value: Pick<KnowledgeDocumentSourceValue, 'filename' | 'fileUrl'> &
    Partial<Omit<KnowledgeDocumentSourceValue, 'filename' | 'fileUrl' | 'date1' | 'date2'>> & {
      date1?: Date | string | null
      date2?: Date | string | null
    }
): KnowledgeDocumentSourceValue {
  return {
    filename: value.filename,
    fileUrl: value.fileUrl,
    contentHash: value.contentHash ?? null,
    sourceUrl: value.sourceUrl ?? null,
    tag1: value.tag1 ?? null,
    tag2: value.tag2 ?? null,
    tag3: value.tag3 ?? null,
    tag4: value.tag4 ?? null,
    tag5: value.tag5 ?? null,
    tag6: value.tag6 ?? null,
    tag7: value.tag7 ?? null,
    number1: value.number1 ?? null,
    number2: value.number2 ?? null,
    number3: value.number3 ?? null,
    number4: value.number4 ?? null,
    number5: value.number5 ?? null,
    date1: normalizeKnowledgeDocumentDate(value.date1),
    date2: normalizeKnowledgeDocumentDate(value.date2),
    boolean1: value.boolean1 ?? null,
    boolean2: value.boolean2 ?? null,
    boolean3: value.boolean3 ?? null,
  }
}

export function readBoundKnowledgeDocumentSecretProvenance(
  row: KnowledgeDocumentSecretProvenanceRow
): DurableSecretProvenance {
  if (row.secretProvenanceVersion === null) {
    return EXACT_EMPTY_DURABLE_SECRET_PROVENANCE
  }
  const sourceHash = hashDurableSecretProvenanceValue(row.source)
  if (
    row.secretProvenanceVersion !== 1 ||
    row.status !== 'exact' ||
    !sourceHash ||
    row.provenanceSourceHash !== sourceHash
  ) {
    return { status: 'unknown' }
  }
  const entries = normalizeDurableSecretProvenanceEntries(row.entries)
  return entries ? { status: 'exact', entries } : { status: 'unknown' }
}

export function readBoundKnowledgeEmbeddingSecretProvenance(
  row: KnowledgeEmbeddingSecretProvenanceRow
): DurableSecretProvenance {
  if (row.secretProvenanceVersion === null) {
    return EXACT_EMPTY_DURABLE_SECRET_PROVENANCE
  }
  const actualHash = sha256Hex(row.content)
  if (
    row.secretProvenanceVersion !== 1 ||
    row.status !== 'exact' ||
    row.chunkHash !== actualHash ||
    row.provenanceContentHash !== actualHash
  ) {
    return { status: 'unknown' }
  }
  const entries = normalizeDurableSecretProvenanceEntries(row.entries)
  return entries ? { status: 'exact', entries } : { status: 'unknown' }
}

async function replaceSidecarInTx(options: {
  tx: DbTransaction
  identity: Record<string, string>
  hashField: Record<string, string>
  provenance: DurableSecretProvenance
  cause?: 'source-hash-unavailable'
}): Promise<void> {
  const entries =
    options.provenance.status === 'exact'
      ? normalizeDurableSecretProvenanceEntries(options.provenance.entries)
      : []
  const values = {
    ...options.identity,
    ...options.hashField,
    status: options.provenance.status === 'exact' && entries ? 'exact' : 'unknown',
    entries: entries ?? [],
    updatedAt: new Date(),
  }
  if ('documentId' in options.identity) {
    await options.tx
      .insert(documentSecretProvenance)
      .values(values as typeof documentSecretProvenance.$inferInsert)
      .onConflictDoUpdate({
        target: documentSecretProvenance.documentId,
        set: values,
      })
  } else {
    await options.tx
      .insert(embeddingSecretProvenance)
      .values(values as typeof embeddingSecretProvenance.$inferInsert)
      .onConflictDoUpdate({ target: embeddingSecretProvenance.embeddingId, set: values })
  }
  if (values.status === 'unknown') {
    reportDurableSecretProvenanceWrite({
      surface: 'knowledge',
      status: 'unknown',
      cause:
        options.cause ??
        (options.provenance.status === 'unknown'
          ? 'source-provenance-unknown'
          : 'invalid-provenance-entries'),
      resourceId: options.identity.documentId ?? options.identity.embeddingId,
    })
  }
}

/** Atomically tracks one document ingestion source. */
export async function replaceKnowledgeDocumentSecretProvenanceInTx(
  tx: DbTransaction,
  documentId: string,
  source: KnowledgeDocumentSourceValue,
  provenance: DurableSecretProvenance
): Promise<void> {
  const sourceHash = hashDurableSecretProvenanceValue(source)
  await replaceSidecarInTx({
    tx,
    identity: { documentId },
    hashField: { sourceHash: sourceHash ?? 'unavailable' },
    provenance: sourceHash ? provenance : { status: 'unknown' },
    ...(sourceHash ? {} : { cause: 'source-hash-unavailable' }),
  })
  await tx.update(document).set({ secretProvenanceVersion: 1 }).where(eq(document.id, documentId))
}

/** Atomically tracks one raw chunk while its vector remains derived from projected content. */
export async function replaceKnowledgeEmbeddingSecretProvenanceInTx(
  tx: DbTransaction,
  embeddingId: string,
  content: string,
  provenance: DurableSecretProvenance
): Promise<void> {
  await replaceSidecarInTx({
    tx,
    identity: { embeddingId },
    hashField: { contentHash: sha256Hex(content) },
    provenance,
  })
  await tx
    .update(embedding)
    .set({ secretProvenanceVersion: 1 })
    .where(eq(embedding.id, embeddingId))
}

/** Loads a document source registry before parsing, OCR, chunking, or embedding. */
export async function loadKnowledgeDocumentSecretRegistry(
  documentId: string,
  scope: ResolvedSecretTraceScopeV1,
  currentSourceFileProvenance?: DurableSecretProvenance
): Promise<{
  registry?: ResolvedSecretTraceRegistry
  provenance: DurableSecretProvenance
  tracked: boolean
}> {
  const [row] = await selectKnowledgeDocumentProvenanceRows(eq(document.id, documentId)).limit(1)
  if (!row) throw new Error('Document not found')
  const source = createKnowledgeDocumentSourceValue(row)
  const persistedProvenance = filterKnowledgeDocumentContentSecretProvenance(
    readBoundKnowledgeDocumentSecretProvenance({ ...row, source }),
    source
  )
  const provenance = currentSourceFileProvenance
    ? mergeDurableSecretProvenance(
        persistedProvenance,
        bindKnowledgeDocumentFieldSecretProvenance(currentSourceFileProvenance, 'content', {
          fileUrl: source.fileUrl,
          contentHash: source.contentHash,
        })
      )
    : persistedProvenance
  if (provenance.status === 'unknown') {
    reportDurableSecretProvenanceRefusal({
      surface: 'knowledge',
      cause: 'knowledge-document-source-unavailable',
      workspaceId: scope.workspaceId,
      resourceId: documentId,
    })
    throw new Error('Knowledge document secret provenance is unavailable')
  }
  if (provenance.entries.length === 0)
    return {
      provenance,
      tracked: row.secretProvenanceVersion === 1 || currentSourceFileProvenance !== undefined,
    }
  const registry = new ResolvedSecretTraceRegistry([], scope)
  if (!(await importDurableSecretProvenance(registry, provenance, undefined, 'knowledge'))) {
    throw new Error('Knowledge document secret provenance is unavailable')
  }
  return { registry, provenance, tracked: true }
}

/** Loads the bound document classification for copy/re-entry callers that do not need a registry. */
export async function loadKnowledgeDocumentDurableSecretProvenance(documentId: string): Promise<{
  source: KnowledgeDocumentSourceValue
  provenance: DurableSecretProvenance
  tracked: boolean
}> {
  const [row] = await selectKnowledgeDocumentProvenanceRows(eq(document.id, documentId)).limit(1)
  if (!row) throw new Error('Document not found')
  const source = createKnowledgeDocumentSourceValue(row)
  return {
    source,
    provenance: readBoundKnowledgeDocumentSecretProvenance({ ...row, source }),
    tracked: row.secretProvenanceVersion === 1,
  }
}

/**
 * Imports provenance for one bounded, exact persisted response snapshot. The supplied values are
 * compared with a fresh joined row before import, so a concurrent write cannot pair stale response
 * data with newer provenance.
 */
export async function importKnowledgePersistedResponseSecretProvenance(options: {
  registry: ResolvedSecretTraceRegistry
  documents?: readonly {
    id: string
    source: KnowledgeDocumentSourceValue
    value: unknown
  }[]
  chunks?: readonly {
    id: string
    documentId: string
    content: string
    value: unknown
  }[]
  /** Names the workspace in the aggregated unrecorded-read audit entry; legacy KBs have none. */
  workspaceId?: string
  /** Whose access authorized the read, for the same entry. */
  actorUserId?: string
}): Promise<boolean> {
  const documents = options.documents ?? []
  const chunks = options.chunks ?? []
  /**
   * Counted here and reported once at the end of the proceed path, the shape the memory and table
   * surfaces use: the per-record import knows no workspace, so its report never produced the
   * workspace-visible audit entry, and it logged once per record. A fault return skips the report —
   * that read fails closed, so no unvouched record reached anything.
   */
  const knowledgeEnforced = isDurableSecretProvenanceEnforced('knowledge')
  let unrecordedCount = 0
  const documentIds = [...new Set(documents.map((item) => item.id))]
  const chunkIds = [...new Set(chunks.map((item) => item.id))]
  const [documentRows, chunkRows] = await Promise.all([
    documentIds.length
      ? selectKnowledgeDocumentProvenanceRows(
          and(
            inArray(document.id, documentIds),
            isNull(document.archivedAt),
            isNull(document.deletedAt)
          )
        )
      : [],
    chunkIds.length ? selectKnowledgeEmbeddingProvenanceRows(inArray(embedding.id, chunkIds)) : [],
  ])

  const documentById = new Map(documentRows.map((row) => [row.id, row]))
  const chunkById = new Map(chunkRows.map((row) => [row.id, row]))
  if (documentById.size !== documentIds.length || chunkById.size !== chunkIds.length) {
    options.registry.markIncomplete('knowledge-row-missing')
    return false
  }

  for (const item of documents) {
    const row = documentById.get(item.id)
    if (!row) {
      options.registry.markIncomplete('knowledge-row-missing')
      return false
    }
    const source = createKnowledgeDocumentSourceValue(row)
    const actualSourceHash = hashDurableSecretProvenanceValue(source)
    const expectedSourceHash = hashDurableSecretProvenanceValue(
      createKnowledgeDocumentSourceValue(item.source)
    )
    if (!actualSourceHash || !expectedSourceHash || actualSourceHash !== expectedSourceHash) {
      options.registry.markIncomplete('knowledge-row-content-mismatch')
      return false
    }
    const provenance = filterKnowledgeDocumentMetadataSecretProvenance(
      readBoundKnowledgeDocumentSecretProvenance({ ...row, source }),
      source
    )
    if (provenance.status === 'unknown' && !knowledgeEnforced) unrecordedCount += 1
    if (
      !(await importDurableSecretProvenance(options.registry, provenance, item.value, 'knowledge', {
        reportUnrecorded: false,
      }))
    ) {
      return false
    }
  }

  for (const item of chunks) {
    const row = chunkById.get(item.id)
    if (!row || row.documentId !== item.documentId || row.content !== item.content) {
      options.registry.markIncomplete('knowledge-row-content-mismatch')
      return false
    }
    const provenance = readBoundKnowledgeEmbeddingSecretProvenance(row)
    if (provenance.status === 'unknown' && !knowledgeEnforced) unrecordedCount += 1
    if (
      !(await importDurableSecretProvenance(options.registry, provenance, item.value, 'knowledge', {
        reportUnrecorded: false,
      }))
    ) {
      return false
    }
  }

  if (unrecordedCount > 0) {
    reportUnrecordedDurableProvenance({
      surface: 'knowledge',
      cause: 'durable-provenance-unknown',
      affectedCount: unrecordedCount,
      ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
      actorUserId: options.actorUserId ?? null,
    })
  }
  return !options.registry.isPermanentlyIncomplete()
}

/** Imports persisted chunk/document provenance before reranking or private response export. */
export async function importKnowledgeSearchResultSecretProvenance(options: {
  registry: ResolvedSecretTraceRegistry
  results: readonly { id: string; documentId: string; content: string }[]
}): Promise<{
  imported: boolean
  /**
   * Chunks whose stored provenance was unrecorded and whose import proceeded fail-open. The caller
   * folds this into one read-level audit report — it owns the workspace and the metadata imports
   * that share the same read, and it reports nothing when the registry latched, since a latched
   * read never reaches a model.
   */
  unrecordedCount: number
  documentMetadata: Record<
    string,
    {
      filename: string
      sourceUrl: string | null
      tag1: string | null
      tag2: string | null
      tag3: string | null
      tag4: string | null
      tag5: string | null
      tag6: string | null
      tag7: string | null
      provenance: DurableSecretProvenance
    }
  >
}> {
  if (options.results.length === 0) {
    return { imported: true, unrecordedCount: 0, documentMetadata: {} }
  }
  const embeddingIds = [...new Set(options.results.map((result) => result.id))]
  const documentIds = [...new Set(options.results.map((result) => result.documentId))]
  const [chunks, documents] = await Promise.all([
    selectKnowledgeEmbeddingProvenanceRows(inArray(embedding.id, embeddingIds)),
    selectKnowledgeDocumentProvenanceRows(
      and(
        inArray(document.id, documentIds),
        eq(document.userExcluded, false),
        isNull(document.archivedAt),
        isNull(document.deletedAt)
      )
    ),
  ])
  const chunkById = new Map(chunks.map((row) => [row.id, row]))
  if (chunkById.size !== embeddingIds.length) {
    return { imported: false, unrecordedCount: 0, documentMetadata: {} }
  }
  const knowledgeEnforced = isDurableSecretProvenanceEnforced('knowledge')
  let unrecordedCount = 0
  for (const result of options.results) {
    const row = chunkById.get(result.id)
    if (!row || row.documentId !== result.documentId || row.content !== result.content) {
      return { imported: false, unrecordedCount: 0, documentMetadata: {} }
    }
    const provenance = readBoundKnowledgeEmbeddingSecretProvenance(row)
    if (provenance.status === 'unknown' && !knowledgeEnforced) unrecordedCount += 1
    if (
      !(await importDurableSecretProvenance(
        options.registry,
        provenance,
        result.content,
        'knowledge',
        { reportUnrecorded: false }
      ))
    ) {
      return { imported: false, unrecordedCount: 0, documentMetadata: {} }
    }
  }
  const documentById = new Map(documents.map((row) => [row.id, row]))
  if (documentById.size !== documentIds.length) {
    return { imported: false, unrecordedCount: 0, documentMetadata: {} }
  }
  if (options.results.some((result) => !documentById.has(result.documentId))) {
    return { imported: false, unrecordedCount: 0, documentMetadata: {} }
  }
  const documentMetadata: Record<
    string,
    {
      filename: string
      sourceUrl: string | null
      tag1: string | null
      tag2: string | null
      tag3: string | null
      tag4: string | null
      tag5: string | null
      tag6: string | null
      tag7: string | null
      provenance: DurableSecretProvenance
    }
  > = {}
  for (const row of documents) {
    const source = createKnowledgeDocumentSourceValue(row)
    const provenance = filterKnowledgeDocumentMetadataSecretProvenance(
      readBoundKnowledgeDocumentSecretProvenance({ ...row, source }),
      source,
      ['filename', 'sourceUrl', 'tag1', 'tag2', 'tag3', 'tag4', 'tag5', 'tag6', 'tag7']
    )
    documentMetadata[row.id] = {
      filename: row.filename,
      sourceUrl: row.sourceUrl,
      tag1: row.tag1,
      tag2: row.tag2,
      tag3: row.tag3,
      tag4: row.tag4,
      tag5: row.tag5,
      tag6: row.tag6,
      tag7: row.tag7,
      provenance,
    }
  }
  return {
    imported: !options.registry.isPermanentlyIncomplete(),
    unrecordedCount,
    documentMetadata,
  }
}
