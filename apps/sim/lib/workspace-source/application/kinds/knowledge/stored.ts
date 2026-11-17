/**
 * A stored knowledge base as source sees it: its settings, the documents source may manage, and
 * the declaration and fingerprint they read as. Uploaded documents never change in place (a
 * replace is a new document), so a document id the base records at the same upload time still
 * holds the bytes the base hashed; any other document's hash is unknown until it is downloaded.
 */
import { compareStrings } from '@sim/utils/string'
import { stableStringify } from '@sim/workflow-code'
import { type BaseResource, fingerprintOf, type ResourceFingerprint } from '@sim/workspace-code'
import {
  canonicalChunking,
  isKnowledgeDocName,
  type KnowledgeBaseDecl,
  type KnowledgeChunkingDecl,
  type KnowledgeDocDecl,
  knowledgeCodec,
} from '@sim/workspace-code/kinds/knowledge'
import { WORKSPACE_SOURCE_LIMITS } from '@sim/workspace-code/limits'
import { listKnowledgeDocuments } from '@/lib/knowledge/application/documents'
import type { KnowledgeBaseWithCounts } from '@/lib/knowledge/types'
import type { SourceContext, StoredResource } from '@/lib/workspace-source/application/types'

/** A stored knowledge base: its settings and the folder it is in (`/` at the root). */
export interface StoredKnowledgeState {
  knowledgeBase: KnowledgeBaseWithCounts
  folderPath: string
}

export type StoredKnowledgeBase = StoredResource<StoredKnowledgeState>

/** One stored document, as far as source reads it. */
export interface StoredDoc {
  id: string
  filename: string
  fileSize: number
  fileUrl: string
  uploadedAt: Date
  connectorId: string | null
  /** Whether it holds a tag value, which a replace does not carry over. */
  tagged: boolean
}

/** A document's revision in the base: when it was uploaded. */
function docRevision(doc: StoredDoc): number {
  return doc.uploadedAt.getTime()
}

const DOC_PAGE = 100
const TAG_FIELDS = [
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
] as const

/** Every document of a knowledge base the caller can read, through the document list use case. */
export async function loadDocs(ctx: SourceContext, knowledgeBaseId: string): Promise<StoredDoc[]> {
  const docs = new Map<string, StoredDoc>()
  for (let offset = 0; ; offset += DOC_PAGE) {
    const page = await listKnowledgeDocuments.execute({
      principal: ctx.principal,
      input: {
        knowledgeBaseId,
        assertedWorkspaceId: ctx.workspace.workspaceId,
        enabledFilter: 'all',
        limit: DOC_PAGE,
        offset,
      },
    })
    for (const doc of page.documents) {
      docs.set(doc.id, {
        id: doc.id,
        filename: doc.filename,
        fileSize: doc.fileSize,
        fileUrl: doc.fileUrl,
        uploadedAt: doc.uploadedAt,
        connectorId: doc.connectorId,
        tagged: TAG_FIELDS.some((field) => doc[field] !== null && doc[field] !== ''),
      })
    }
    if (!page.pagination.hasMore || page.documents.length === 0) break
  }
  return [...docs.values()]
}

/**
 * The documents source manages, by file name: uploaded (not connector-synced), small enough to
 * be a blob, and named as a plain file. A name several such documents share is `ambiguous`:
 * neither printed nor written until only one holds it.
 */
export function sourceDocs(docs: readonly StoredDoc[]): {
  byName: Map<string, StoredDoc>
  ambiguous: Set<string>
  /** Documents source leaves alone (connector-synced, too large, an odd name, ambiguous). */
  unmanaged: number
} {
  const byName = new Map<string, StoredDoc>()
  const ambiguous = new Set<string>()
  let unmanaged = 0
  for (const doc of docs) {
    if (
      doc.connectorId !== null ||
      doc.fileSize > WORKSPACE_SOURCE_LIMITS.maxBlobBytes ||
      !isKnowledgeDocName(doc.filename)
    ) {
      unmanaged += 1
    } else if (byName.has(doc.filename) || ambiguous.has(doc.filename)) {
      ambiguous.add(doc.filename)
      byName.delete(doc.filename)
    } else {
      byName.set(doc.filename, doc)
    }
  }
  for (const doc of docs) if (ambiguous.has(doc.filename)) unmanaged += 1
  return { byName, ambiguous, unmanaged }
}

/** The stored chunking settings as a declaration, or `undefined` when they are the defaults. */
export function storedChunking(state: StoredKnowledgeState): KnowledgeChunkingDecl | undefined {
  const { maxSize, minSize, overlap, strategy, strategyOptions } =
    state.knowledgeBase.chunkingConfig
  const chunking: KnowledgeChunkingDecl = { maxSize, minSize, overlap }
  if (strategy !== undefined) chunking.strategy = strategy
  if (strategyOptions && Object.keys(strategyOptions).length > 0) {
    const { pattern, separators, recipe, strictBoundaries } = strategyOptions
    chunking.strategyOptions = {
      ...(pattern !== undefined ? { pattern } : {}),
      ...(separators !== undefined ? { separators } : {}),
      ...(recipe !== undefined ? { recipe } : {}),
      ...(strictBoundaries !== undefined ? { strictBoundaries } : {}),
    }
  }
  return sameChunking(chunking, undefined) ? undefined : chunking
}

/** Whether two chunking declarations resolve to the same settings. */
export function sameChunking(
  a: KnowledgeChunkingDecl | undefined,
  b: KnowledgeChunkingDecl | undefined
): boolean {
  return stableStringify(canonicalChunking(a)) === stableStringify(canonicalChunking(b))
}

/** A stored knowledge base read as source under the document hashes known so far. */
export interface KnowledgeView {
  /** What prints: only documents whose hash is known. */
  decl: KnowledgeBaseDecl
  /** Over every managed document; one of unknown hash stands in by its id, so it never matches. */
  fingerprint: ResourceFingerprint
  base: BaseResource
}

/**
 * Reads a stored knowledge base and its documents as source. `hashes` maps document id → SHA-256
 * for the documents whose bytes are known (from the base, a download or this apply's upload).
 */
export function knowledgeView(
  stored: StoredKnowledgeBase,
  docs: readonly StoredDoc[],
  hashes: ReadonlyMap<string, string>
): KnowledgeView {
  const { knowledgeBase, folderPath } = stored.state
  const managed = [...sourceDocs(docs).byName.values()].sort((a, b) =>
    compareStrings(a.filename, b.filename)
  )
  const printed: Array<[string, KnowledgeDocDecl]> = []
  const fingerprinted: Array<[string, KnowledgeDocDecl]> = []
  const blobs: Array<[string, { id: string; rev: number; sha256: string }]> = []
  for (const doc of managed) {
    const sha256 = hashes.get(doc.id)
    fingerprinted.push([doc.filename, { sha256: sha256 ?? `doc:${doc.id}`, size: doc.fileSize }])
    if (sha256 === undefined) continue
    printed.push([doc.filename, { sha256, size: doc.fileSize }])
    blobs.push([doc.filename, { id: doc.id, rev: docRevision(doc), sha256 }])
  }
  const chunking = storedChunking(stored.state)
  const settings = {
    name: knowledgeBase.name,
    ...(knowledgeBase.description ? { description: knowledgeBase.description } : {}),
    ...(folderPath !== '/' ? { folder: folderPath } : {}),
    ...(chunking ? { chunking } : {}),
    embeddingModel: knowledgeBase.embeddingModel,
  }
  const fingerprint = fingerprintOf(
    knowledgeCodec.canonical({ ...settings, docs: Object.fromEntries(fingerprinted) })
  )
  return {
    decl: { ...settings, docs: Object.fromEntries(printed) },
    fingerprint,
    base: {
      id: stored.id,
      fingerprint,
      ...(blobs.length > 0 ? { blobs: Object.fromEntries(blobs) } : {}),
    },
  }
}

/** The hashes the base vouches for: a document it records under the same id and upload time. */
export function baseHashes(
  docs: readonly StoredDoc[],
  base: BaseResource | undefined
): Map<string, string> {
  const hashes = new Map<string, string>()
  if (!base?.blobs) return hashes
  for (const doc of docs) {
    if (!Object.hasOwn(base.blobs, doc.filename)) continue
    const entry = base.blobs[doc.filename]
    if (entry.id === doc.id && entry.rev === docRevision(doc)) hashes.set(doc.id, entry.sha256)
  }
  return hashes
}
