/**
 * A stored knowledge base as source sees it: its settings, the documents source may manage, and
 * the declaration and fingerprint they read as. Uploaded documents never change in place (a
 * replace is a new document), so a document id the base records at the same upload time still
 * holds the bytes the base hashed; any other document's hash is unknown until it is downloaded.
 */
import { compareStrings } from '@sim/utils/string'
import { stableStringify } from '@sim/workflow-code'
import { type BaseResource, fingerprintOf, type ResourceFingerprint } from '@sim/workspace-code'
import { foldedFileKey } from '@sim/workspace-code/kinds/files'
import {
  canonicalChunking,
  isKnowledgeDocName,
  type KnowledgeBaseDecl,
  type KnowledgeChunkingDecl,
  type KnowledgeDocDecl,
  knowledgeCodec,
} from '@sim/workspace-code/kinds/knowledge'
import { WORKSPACE_SOURCE_LIMITS } from '@sim/workspace-code/limits'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { listKnowledgeDocuments } from '@/lib/knowledge/application/documents'
import { ALL_TAG_SLOTS } from '@/lib/knowledge/constants'
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

/** A document's revision: its upload time, which a replace (a new document) changes. */
export function docRevision(doc: StoredDoc): number {
  return doc.uploadedAt.getTime()
}

const DOC_PAGE = 100

/**
 * Every document of a knowledge base the caller can read, through the document list use case.
 * Refuses one holding more documents than a directory lists (`maxBlobs`), after one page past it.
 */
export async function loadDocs(ctx: SourceContext, knowledgeBaseId: string): Promise<StoredDoc[]> {
  const docs = new Map<string, StoredDoc>()
  for (let offset = 0; ; offset += DOC_PAGE) {
    if (docs.size > WORKSPACE_SOURCE_LIMITS.maxBlobs) {
      throw new OrchestrationError(
        'payload_too_large',
        `This knowledge base holds more than ${WORKSPACE_SOURCE_LIMITS.maxBlobs} documents, more than one directory lists.`
      )
    }
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
        tagged: ALL_TAG_SLOTS.some((field) => doc[field] !== null && doc[field] !== ''),
      })
    }
    if (!page.pagination.hasMore || page.documents.length === 0) break
  }
  return [...docs.values()]
}

/**
 * The documents source manages, by file name: uploaded (not connector-synced), small enough to
 * be a blob, and named as a plain file. A name several such documents share is `ambiguous`:
 * neither printed nor written until only one holds it. A name a case-insensitive or
 * normalizing disk would merge with another managed one (`Report.pdf` beside `report.pdf`) is
 * left out too, after the first in name order, so a get never writes two documents to one file.
 * The rule and order are `foldedFileKey` over sorted names, as the knowledge codec reads them.
 */
export function sourceDocs(docs: readonly StoredDoc[]): {
  byName: Map<string, StoredDoc>
  ambiguous: Map<string, StoredDoc[]>
  /** Documents source leaves alone (connector-synced, too large, an odd name, ambiguous). */
  unmanaged: number
} {
  const named = new Map<string, StoredDoc[]>()
  let unmanaged = 0
  for (const doc of docs) {
    if (
      doc.connectorId !== null ||
      doc.fileSize > WORKSPACE_SOURCE_LIMITS.maxBlobBytes ||
      !isKnowledgeDocName(doc.filename)
    ) {
      unmanaged += 1
      continue
    }
    const holders = named.get(doc.filename)
    if (holders) holders.push(doc)
    else named.set(doc.filename, [doc])
  }
  const byName = new Map<string, StoredDoc>()
  const ambiguous = new Map<string, StoredDoc[]>()
  const folded = new Set<string>()
  for (const name of [...named.keys()].sort(compareStrings)) {
    const holders = named.get(name) ?? []
    if (folded.has(foldedFileKey(name))) {
      unmanaged += holders.length
      continue
    }
    folded.add(foldedFileKey(name))
    if (holders.length === 1) {
      byName.set(name, holders[0])
    } else {
      ambiguous.set(name, holders)
      unmanaged += holders.length
    }
  }
  return { byName, ambiguous, unmanaged }
}

/**
 * The documents a plan may hash: every managed one, and both documents of a name held twice,
 * which a replace interrupted between its upload and its delete leaves behind.
 */
export function hashableDocs(docs: readonly StoredDoc[]): StoredDoc[] {
  const { byName, ambiguous } = sourceDocs(docs)
  return [
    ...byName.values(),
    ...[...ambiguous.values()].filter((holders) => holders.length === 2).flat(),
  ]
}

/**
 * The stale half of a replace interrupted between its upload and its delete: of two documents
 * under one name, the one the base records, when the other hashes to the declared content.
 */
export function supersededDuplicate(
  holders: readonly StoredDoc[],
  hashes: ReadonlyMap<string, string>,
  base: BaseResource | undefined,
  sha256: string
): StoredDoc | undefined {
  if (holders.length !== 2) return undefined
  const recorded = baseHashes(holders, base)
  const old = holders.find((doc) => recorded.has(doc.id))
  const replacement = holders.find((doc) => !recorded.has(doc.id))
  return old && replacement && hashes.get(replacement.id) === sha256 ? old : undefined
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
  const settings = storedSettings(stored)
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

/** A stored knowledge base's settings as a declaration, without its documents. */
function storedSettings(stored: StoredKnowledgeBase): Omit<KnowledgeBaseDecl, 'docs'> {
  const { knowledgeBase, folderPath } = stored.state
  const chunking = storedChunking(stored.state)
  return {
    name: knowledgeBase.name,
    ...(knowledgeBase.description ? { description: knowledgeBase.description } : {}),
    ...(folderPath !== '/' ? { folder: folderPath } : {}),
    ...(chunking ? { chunking } : {}),
    embeddingModel: knowledgeBase.embeddingModel,
  }
}

/** The fingerprint of a declaration's settings beside the documents given by name → hash. */
function settingsFingerprint(
  settings: Omit<KnowledgeBaseDecl, 'docs'>,
  docs: ReadonlyMap<string, string>
): ResourceFingerprint {
  return fingerprintOf(
    knowledgeCodec.canonical({
      ...settings,
      docs: Object.fromEntries([...docs].map(([name, sha256]) => [name, { sha256, size: 0 }])),
    })
  )
}

/**
 * Whether every change the server took since `base` is one `decl` declares, as an apply that
 * stopped partway leaves it: settings that now equal the declared ones, documents that now hash
 * to the declared bytes or are gone where the declaration drops them, and a replaced document
 * still stored beside its replacement. Such a server is planned from the base, so the next apply
 * finishes the rest instead of refusing it as stale. A document of unknown hash never matches.
 */
export function movedTowardDecl(input: {
  decl: KnowledgeBaseDecl
  stored: StoredKnowledgeBase
  docs: readonly StoredDoc[]
  hashes: ReadonlyMap<string, string>
  base: BaseResource
}): boolean {
  const { decl, stored, docs, hashes, base } = input
  const settings = storedSettings(stored)
  const baseDocs = new Map(
    Object.entries(base.blobs ?? {}).map(([name, entry]) => [name, entry.sha256])
  )
  const none = new Map<string, string>()
  if (
    settingsFingerprint(settings, none) !== settingsFingerprint(decl, none) &&
    settingsFingerprint(settings, baseDocs) !== base.fingerprint
  ) {
    return false
  }
  const declared = (name: string) =>
    Object.hasOwn(decl.docs, name) ? decl.docs[name].sha256 : undefined
  const { byName, ambiguous } = sourceDocs(docs)
  /** Name → its hash on the server now; `null` when that is unknown. */
  const server = new Map<string, string | null>()
  for (const [name, doc] of byName) server.set(name, hashes.get(doc.id) ?? null)
  for (const [name, holders] of ambiguous) {
    const sha256 = declared(name)
    const settled = sha256 !== undefined && supersededDuplicate(holders, hashes, base, sha256)
    server.set(name, settled ? sha256 : null)
  }
  for (const name of new Set([...baseDocs.keys(), ...server.keys()])) {
    const now = server.get(name)
    if (now === null) return false
    if (now !== baseDocs.get(name) && now !== declared(name)) return false
  }
  return true
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
    /** A get's client records a revision it was listed as a string. */
    if (entry.id === doc.id && String(entry.rev) === String(docRevision(doc))) {
      hashes.set(doc.id, entry.sha256)
    }
  }
  return hashes
}
