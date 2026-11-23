/**
 * A stored knowledge base as source sees it: its settings, the documents source may manage, and
 * the declaration and fingerprint they read as. Uploaded documents never change in place (a
 * replace is a new document), so a document id the base records at the same upload time still
 * holds the bytes the base hashed; any other document's hash is unknown until it is downloaded.
 */
import { chunkArray } from '@sim/utils/helpers'
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
import {
  listKnowledgeDocumentsAfter,
  MAX_DOCUMENTS_PAGE_AFTER,
} from '@/lib/knowledge/application/documents'
import { ALL_TAG_SLOTS, type AllTagSlot } from '@/lib/knowledge/constants'
import { getDocumentIndexingStatus } from '@/lib/knowledge/documents/types'
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
  /** The SHA-256 of its original bytes, when recorded (on upload, or a first read). */
  fileSha256: string | null
  uploadedAt: Date
  connectorId: string | null
  /** Its tag values by slot, as the document update takes them: a replace carries them over. */
  tags: Partial<Record<AllTagSlot, string>>
  /** Its indexing state; never part of a fingerprint, only of a get's or apply's findings. */
  processingStatus: string
  /**
   * Set on a replacement a replace left under its upload name ({@link replacementName}) when it
   * stopped partway. `stray` while the document it `replaces` is still stored: the replace
   * stopped before its delete, so this one is not its name's document yet. Otherwise only the
   * rename was left: the document reads as its name's (`filename` is that name), and
   * `uploadName` is what it is stored as.
   */
  replacing?: { replaces: string; uploadName: string; stray: boolean }
}

/**
 * The name a replace uploads a document's replacement under, naming the document it replaces,
 * until that one is deleted and the replacement renamed: a replace that stops between its writes
 * leaves a replacement this source can tell from any other document (a document uploaded twice
 * in the UI, say), so the next apply finishes or discards it.
 */
export function replacementName(replaces: Pick<StoredDoc, 'id'>, name: string): string {
  return `${REPLACEMENT_PREFIX}${replaces.id}.${name}`
}

const REPLACEMENT_PREFIX = '.sim-replace.'

/** The document a replacement's upload name names, and the name it takes once renamed. */
function parseReplacementName(filename: string): { replaces: string; name: string } | undefined {
  if (!filename.startsWith(REPLACEMENT_PREFIX)) return undefined
  const rest = filename.slice(REPLACEMENT_PREFIX.length)
  const dot = rest.indexOf('.')
  if (dot <= 0 || dot === rest.length - 1) return undefined
  return { replaces: rest.slice(0, dot), name: rest.slice(dot + 1) }
}

/** `docs` with each replacement a stopped replace left marked (see {@link StoredDoc.replacing}). */
function withReplacements(docs: StoredDoc[]): StoredDoc[] {
  const ids = new Set(docs.map((doc) => doc.id))
  return docs.map((doc) => {
    const parsed = doc.connectorId === null ? parseReplacementName(doc.filename) : undefined
    if (!parsed) return doc
    const stray = ids.has(parsed.replaces)
    return {
      ...doc,
      ...(stray ? {} : { filename: parsed.name }),
      replacing: { replaces: parsed.replaces, uploadName: doc.filename, stray },
    }
  })
}

/** A document's revision: its upload time, which a replace (a new document) changes. */
export function docRevision(doc: StoredDoc): number {
  return doc.uploadedAt.getTime()
}

/** A tag value as the document update parses it back: a date as `YYYY-MM-DD` in local time. */
function tagText(value: string | number | boolean | Date): string {
  if (!(value instanceof Date)) return String(value)
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
}

/** The tag values a document holds, by slot. */
function tagValues(
  doc: Record<AllTagSlot, string | number | boolean | Date | null>
): StoredDoc['tags'] {
  const tags: StoredDoc['tags'] = {}
  for (const slot of ALL_TAG_SLOTS) {
    const value = doc[slot]
    if (value !== null && value !== '') tags[slot] = tagText(value)
  }
  return tags
}

/**
 * Every document of a knowledge base the caller can read, through the keyset document list use
 * case, a page of {@link MAX_DOCUMENTS_PAGE_AFTER} at a time in id order, so a document changed,
 * added or deleted while the list is walked never makes another one skipped or listed twice.
 * Refuses one holding more documents than a directory lists (`maxBlobs`), on the page that passes
 * it, the last page included. With `documentIds`, lists only those (the ones still live), as
 * stored; the whole listing marks what a stopped replace left ({@link StoredDoc.replacing}).
 */
export async function loadDocs(
  ctx: SourceContext,
  knowledgeBaseId: string,
  documentIds?: readonly string[]
): Promise<StoredDoc[]> {
  if (documentIds === undefined) return withReplacements(await walkDocs(ctx, knowledgeBaseId))
  const docs: StoredDoc[] = []
  for (const ids of chunkArray([...documentIds], MAX_DOCUMENTS_PAGE_AFTER)) {
    docs.push(...(await walkDocs(ctx, knowledgeBaseId, ids)))
  }
  return docs
}

async function walkDocs(
  ctx: SourceContext,
  knowledgeBaseId: string,
  documentIds?: string[]
): Promise<StoredDoc[]> {
  const docs: StoredDoc[] = []
  for (let after: string | null = null; ; ) {
    const page = await listKnowledgeDocumentsAfter.execute({
      principal: ctx.principal,
      input: {
        knowledgeBaseId,
        assertedWorkspaceId: ctx.workspace.workspaceId,
        after,
        limit: MAX_DOCUMENTS_PAGE_AFTER,
        ...(documentIds ? { documentIds } : {}),
      },
    })
    for (const doc of page.documents) {
      docs.push({
        id: doc.id,
        filename: doc.filename,
        fileSize: doc.fileSize,
        fileSha256: doc.fileSha256,
        uploadedAt: doc.uploadedAt,
        connectorId: doc.connectorId,
        tags: tagValues(doc),
        processingStatus: getDocumentIndexingStatus(doc),
      })
    }
    if (docs.length > WORKSPACE_SOURCE_LIMITS.maxBlobs) {
      throw new OrchestrationError(
        'payload_too_large',
        `This knowledge base holds more than ${WORKSPACE_SOURCE_LIMITS.maxBlobs} documents, more than one directory lists.`
      )
    }
    // A page can come back short, even empty, while later ones hold readable documents: the
    // list admits each document after it pages, so only `next` ends the walk.
    if (page.next === null) break
    after = page.next
  }
  return docs
}

/**
 * The documents source manages, by file name: uploaded (not connector-synced), small enough to
 * be a blob, and named as a plain file. A name several such documents share is `ambiguous`:
 * neither printed nor written until only one holds it. A name a case-insensitive or
 * normalizing disk would merge with another managed one (`Report.pdf` beside `report.pdf`) is
 * left out too, after the first in name order, so a get never writes two documents to one file.
 * The rule and order are `foldedFileKey` over sorted names, as the knowledge codec reads them.
 */
export function sourceDocs(docs: readonly StoredDoc[]): SourceDocs {
  const cached = sourceDocsCache.get(docs)
  if (cached) return cached
  const read = readSourceDocs(docs)
  sourceDocsCache.set(docs, read)
  return read
}

/** The documents source manages, by name (see {@link sourceDocs}). */
interface SourceDocs {
  byName: Map<string, StoredDoc>
  ambiguous: Map<string, StoredDoc[]>
  /** Replacements a replace stopped before its delete left beside the documents they replace. */
  strays: StoredDoc[]
  /** Documents source leaves alone (connector-synced, too large, an odd name, ambiguous). */
  unmanaged: number
}

/** {@link sourceDocs} by document list: one plan reads one list several ways. */
const sourceDocsCache = new WeakMap<readonly StoredDoc[], SourceDocs>()

function readSourceDocs(docs: readonly StoredDoc[]): SourceDocs {
  const named = new Map<string, StoredDoc[]>()
  const strays: StoredDoc[] = []
  let unmanaged = 0
  for (const doc of docs) {
    if (doc.replacing?.stray) {
      strays.push(doc)
      continue
    }
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
  return { byName, ambiguous, strays, unmanaged }
}

/**
 * The documents a plan may hash: every managed one, and each replacement a replace stopped
 * before its delete left, which the next apply finishes when it holds the declared bytes.
 */
export function hashableDocs(docs: readonly StoredDoc[]): StoredDoc[] {
  const { byName, strays } = sourceDocs(docs)
  return [...byName.values(), ...strays]
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
  state: StoredKnowledgeState,
  docs: readonly StoredDoc[],
  hashes: ReadonlyMap<string, string>
): KnowledgeView {
  const managed = [...sourceDocs(docs).byName.values()].sort((a, b) =>
    compareStrings(a.filename, b.filename)
  )
  const printed: Array<[string, KnowledgeDocDecl]> = []
  const fingerprinted: Array<[string, KnowledgeDocDecl]> = []
  const blobs: Array<[string, { id: string; rev: string; sha256: string }]> = []
  for (const doc of managed) {
    const sha256 = hashes.get(doc.id)
    fingerprinted.push([doc.filename, { sha256: sha256 ?? `doc:${doc.id}`, size: doc.fileSize }])
    if (sha256 === undefined) continue
    printed.push([doc.filename, { sha256, size: doc.fileSize }])
    blobs.push([doc.filename, { id: doc.id, rev: String(docRevision(doc)), sha256 }])
  }
  const settings = storedSettings(state)
  const fingerprint = fingerprintOf(
    knowledgeCodec.canonical({ ...settings, docs: Object.fromEntries(fingerprinted) })
  )
  return {
    decl: { ...settings, docs: Object.fromEntries(printed) },
    fingerprint,
    base: {
      id: state.knowledgeBase.id,
      fingerprint,
      ...(blobs.length > 0 ? { blobs: Object.fromEntries(blobs) } : {}),
    },
  }
}

/** A stored knowledge base's settings as a declaration, without its documents. */
function storedSettings(state: StoredKnowledgeState): Omit<KnowledgeBaseDecl, 'docs'> {
  const { knowledgeBase, folderPath } = state
  const chunking = storedChunking(state)
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
 * to the declared bytes or are gone where the declaration drops them, and a replacement a
 * stopped replace left (whatever it holds: the next apply finishes or replaces it). Such a server
 * is planned from the base, so the next apply finishes the rest instead of refusing it as stale.
 * A document of unknown hash never matches.
 */
export function movedTowardDecl(input: {
  decl: KnowledgeBaseDecl
  state: StoredKnowledgeState
  docs: readonly StoredDoc[]
  hashes: ReadonlyMap<string, string>
  base: BaseResource
}): boolean {
  const { decl, state, docs, hashes, base } = input
  const settings = storedSettings(state)
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
  // Name → its hash on the server now; `null` when unknown.
  const server = new Map<string, string | null>()
  for (const [name, doc] of byName) {
    const resumed = doc.replacing ? (declared(name) ?? baseDocs.get(name)) : undefined
    server.set(name, resumed ?? hashes.get(doc.id) ?? null)
  }
  for (const name of ambiguous.keys()) server.set(name, null)
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
    if (entry.id === doc.id && entry.rev === String(docRevision(doc))) {
      hashes.set(doc.id, entry.sha256)
    }
  }
  return hashes
}
