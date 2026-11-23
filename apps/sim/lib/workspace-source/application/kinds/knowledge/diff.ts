/**
 * What applying a knowledge base declaration changes: its settings (name, description, folder,
 * chunking) and its documents, each kept, uploaded, replaced or deleted by file name and hash.
 * A replace is an upload followed by a delete of the old document, never an in-place edit, since
 * the knowledge use cases have none (`upsertKnowledgeDocument` creates a new document too). The
 * replacement therefore has a new id: it is uploaded under a name naming the old document
 * (`replacementName`), takes the old one's tag values, and is renamed once the old one is
 * deleted, so a replace that stops between those writes leaves a replacement the next apply
 * recognizes, then finishes (it holds the declared bytes) or discards and replaces again.
 */
import { createLogger } from '@sim/logger'
import { mapWithConcurrency } from '@sim/utils/concurrency'
import { getErrorMessage } from '@sim/utils/errors'
import type { BaseResource } from '@sim/workspace-code'
import {
  type KnowledgeBaseDecl,
  type KnowledgeChunkingDecl,
  type KnowledgeDocDecl,
  resolvedChunking,
} from '@sim/workspace-code/kinds/knowledge'
import { WORKSPACE_SOURCE_LIMITS } from '@sim/workspace-code/limits'
import { chunkingConfigSchema } from '@/lib/api/contracts/knowledge/base'
import { readOriginalKnowledgeDocument } from '@/lib/knowledge/application/read-original-document'
import type { ChunkingConfig } from '@/lib/knowledge/types'
import { validateFileType } from '@/lib/uploads/utils/validation'
import { kindFinding } from '@/lib/workspace-source/application/findings'
import { HASH_CONCURRENCY, takeHashBudget } from '@/lib/workspace-source/application/hash-budget'
import {
  baseHashes,
  replacementName,
  type StoredDoc,
  type StoredKnowledgeBase,
  sameChunking,
  sourceDocs,
  storedChunking,
} from '@/lib/workspace-source/application/kinds/knowledge/stored'
import type {
  PlanContext,
  SourceContext,
  WorkspaceSourceDiagnostic,
} from '@/lib/workspace-source/application/types'

const logger = createLogger('KnowledgeWorkspaceSourceDiff')

/** One document the apply uploads; `replaces` is the stored document it then deletes. */
export interface DocUpload {
  name: string
  doc: KnowledgeDocDecl
  replaces?: StoredDoc
}

/** The writes one knowledge base change makes, decided at plan time. */
export interface KnowledgeChanges {
  /** The settings the update use case writes; empty when none changed. */
  settings: {
    name?: string
    description?: string
    folderPath?: string
    chunkingConfig?: ChunkingConfig
  }
  uploads: DocUpload[]
  /** Undeclared documents the base records, deleted with `--allow-delete`. */
  deletes: StoredDoc[]
  /**
   * Replaces a stopped replace left before deleting the old document, whose replacement holds the
   * declared bytes: its tags carried over, the old document deleted, the replacement renamed.
   */
  finishes: Array<{ replacement: StoredDoc; replaces: StoredDoc }>
  /** Replacements a stopped replace left before renaming them, holding the declared bytes. */
  renames: StoredDoc[]
  /** Replacements a stopped replace left that this apply does not finish: deleted. */
  discards: StoredDoc[]
  fields: string[]
  /** The `fields` that only add to what the knowledge base holds, which an adopt may write. */
  additions: string[]
  diagnostics: WorkspaceSourceDiagnostic[]
}

const KIND = 'knowledge-base'

/** The full chunking settings a declaration resolves to. */
export function chunkingConfig(chunking: KnowledgeChunkingDecl | undefined): ChunkingConfig {
  return resolvedChunking(chunking)
}

/**
 * Checks only what a change writes: the chunking settings it sets and the documents it uploads.
 * Stored values the change leaves as they are (legacy chunking, an older document type) are never
 * checked, so an unchanged directory always applies.
 */
export function checkWrites(
  key: string,
  writes: { chunking?: ChunkingConfig; uploads: readonly DocUpload[] }
): WorkspaceSourceDiagnostic[] {
  const diagnostics: WorkspaceSourceDiagnostic[] = []
  const chunking = writes.chunking && chunkingConfigSchema.safeParse(writes.chunking)
  if (chunking && !chunking.success) {
    diagnostics.push(
      kindFinding(
        KIND,
        key,
        'E_KB_CHUNKING',
        `The chunking settings are invalid: ${chunking.error.issues.map((issue) => issue.message).join('; ')}.`
      )
    )
  }
  for (const { name, doc } of writes.uploads) {
    const typeError = validateFileType(name, '')
    if (typeError) {
      diagnostics.push(
        kindFinding(KIND, key, 'E_KB_DOC_NAME', `docs/${name}: ${typeError.message}`)
      )
    } else if (doc.size === 0) {
      diagnostics.push(kindFinding(KIND, key, 'E_KB_DOC_EMPTY', `docs/${name} is empty.`))
    }
  }
  return diagnostics
}

/**
 * Adds to `hashes` the hash of each of `docs` it lacks: the one recorded on the document, else
 * its bytes downloaded and hashed through the original-document use case (which records it, so
 * the next read downloads nothing). The request's budget is spent in order first, then the
 * downloads run a few at a time. A document whose bytes are gone stays unhashed. Returns the
 * documents left unchecked: past the request's download budget, or whose download failed (logged),
 * so one unreadable document never fails the whole get or plan.
 */
export async function hashDocs(
  ctx: SourceContext,
  knowledgeBaseId: string,
  docs: Iterable<StoredDoc>,
  hashes: Map<string, string>
): Promise<StoredDoc[]> {
  const unknown = new Map<string, StoredDoc>()
  for (const doc of docs) {
    if (hashes.has(doc.id)) continue
    if (doc.fileSha256 !== null) hashes.set(doc.id, doc.fileSha256)
    else unknown.set(doc.id, doc)
  }
  const { taken, left } = takeHashBudget(ctx, unknown.values(), (doc) => doc.fileSize)
  const failed: StoredDoc[] = []
  const digests = await mapWithConcurrency(taken, HASH_CONCURRENCY, async (doc) => {
    try {
      const original = await readOriginalKnowledgeDocument.execute({
        principal: ctx.principal,
        input: {
          knowledgeBaseId,
          documentId: doc.id,
          assertedWorkspaceId: ctx.workspace.workspaceId,
          maxBytes: WORKSPACE_SOURCE_LIMITS.maxBlobBytes,
        },
      })
      return original.sourceAvailable ? original.sha256 : null
    } catch (error) {
      logger.warn('Could not read a knowledge document to hash it', {
        knowledgeBaseId,
        documentId: doc.id,
        error: getErrorMessage(error),
      })
      failed.push(doc)
      return null
    }
  })
  taken.forEach((doc, index) => {
    const sha256 = digests[index]
    if (sha256 !== null) hashes.set(doc.id, sha256)
  })
  return [...left, ...failed]
}

/**
 * The info line a change gets for the documents it indexes, and for chunking it changes:
 * `storedDocs` counts the stored documents that keep their chunks (neither replaced nor deleted).
 */
export function indexingFindings(
  key: string,
  uploads: readonly DocUpload[],
  chunkingChanged: boolean,
  storedDocs: number
): WorkspaceSourceDiagnostic[] {
  const findings: WorkspaceSourceDiagnostic[] = []
  if (uploads.length > 0) {
    const replaced = uploads.filter((upload) => upload.replaces).length
    findings.push(
      kindFinding(
        KIND,
        key,
        'I_KB_REEMBED',
        `Indexes ${uploads.length} document(s) (${uploads.length - replaced} new, ${replaced} replaced); embedding runs in the background after the apply.`
      )
    )
  }
  if (chunkingChanged && storedDocs > 0) {
    findings.push(
      kindFinding(
        KIND,
        key,
        'I_KB_CHUNKING',
        `New chunking applies to documents indexed from now on; ${storedDocs} stored document(s) keep their chunks.`,
        { hint: 'Replace a document to index it again.' }
      )
    )
  }
  return findings
}

/**
 * Diffs a declaration against a stored knowledge base and its documents. `hashes` holds the
 * document hashes known so far (from the base); a declared document of the stored size whose hash
 * is unknown is downloaded and hashed, so an unchanged document is never re-embedded, and the hash
 * is added (one of another size is replaced without a download). One the request's download
 * budget leaves unhashed is neither uploaded nor deleted, only named. Only a document the base
 * records (an update's `base`) is deleted when undeclared; any other is kept. What a replace that
 * stopped partway left is finished, or discarded when the directory no longer asks for it.
 */
export async function diffKnowledgeBase(input: {
  key: string
  decl: KnowledgeBaseDecl
  stored: StoredKnowledgeBase
  docs: readonly StoredDoc[]
  hashes: Map<string, string>
  base?: BaseResource
  ctx: PlanContext
}): Promise<KnowledgeChanges> {
  const { key, decl, stored, docs, hashes, base, ctx } = input
  const { knowledgeBase, folderPath } = stored.state
  // A replacement left before its rename stands for the document the base records under its name.
  const managed = new Set([
    ...(base ? baseHashes(docs, base).keys() : []),
    ...docs
      .filter(
        (doc) =>
          doc.replacing !== undefined &&
          !doc.replacing.stray &&
          base?.blobs !== undefined &&
          Object.hasOwn(base.blobs, doc.filename) &&
          base.blobs[doc.filename].id === doc.replacing.replaces
      )
      .map((doc) => doc.id),
  ])
  const changes: KnowledgeChanges = {
    settings: {},
    uploads: [],
    deletes: [],
    finishes: [],
    renames: [],
    discards: [],
    fields: [],
    additions: [],
    diagnostics: [],
  }
  if (decl.name !== knowledgeBase.name) {
    changes.settings.name = decl.name
    changes.fields.push('name')
  }
  if ((decl.description ?? '') !== (knowledgeBase.description ?? '')) {
    changes.settings.description = decl.description ?? ''
    changes.fields.push('description')
  }
  if ((decl.folder ?? '/') !== folderPath) {
    changes.settings.folderPath = decl.folder ?? '/'
    changes.fields.push('folder')
  }
  const chunkingChanged = !sameChunking(decl.chunking, storedChunking(stored.state))
  if (chunkingChanged) {
    changes.settings.chunkingConfig = chunkingConfig(decl.chunking)
    changes.fields.push('chunking')
  }

  const { byName, ambiguous, strays } = sourceDocs(docs)
  const comparable: StoredDoc[] = [...strays]
  for (const [name, doc] of Object.entries(decl.docs)) {
    const current = byName.get(name)
    if (current && current.fileSize === doc.size) comparable.push(current)
  }
  const unchecked = new Set(
    (await hashDocs(ctx, stored.id, comparable, hashes)).map((doc) => doc.id)
  )
  const finished = new Set<string>()
  for (const [name, doc] of Object.entries(decl.docs)) {
    if (ambiguous.has(name)) {
      changes.diagnostics.push(
        kindFinding(
          KIND,
          key,
          'E_KB_DOC_AMBIGUOUS',
          `Several stored documents are named "${name}", so docs/${name} cannot tell which one it is.`,
          {
            hint: 'Delete or rename the duplicates in the knowledge base, then get and apply again.',
          }
        )
      )
      continue
    }
    const current = byName.get(name)
    if (!current) {
      const label = `docs/${name} (add)`
      changes.uploads.push({ name, doc })
      changes.fields.push(label)
      changes.additions.push(label)
      continue
    }
    if (unchecked.has(current.id)) {
      changes.diagnostics.push(
        kindFinding(
          KIND,
          key,
          'W_KB_DOC_UNCHECKED',
          `docs/${name} was not compared with the stored document (this request reached its download budget, or the stored bytes could not be read), so it is left as it is.`,
          { hint: 'Apply again to compare it.' }
        )
      )
      continue
    }
    if (hashes.get(current.id) === doc.sha256) {
      if (current.replacing) {
        changes.renames.push(current)
        changes.fields.push(`docs/${name} (replace)`)
      }
      continue
    }
    changes.fields.push(`docs/${name} (replace)`)
    const replacement = strays.find(
      (stray) =>
        stray.replacing?.uploadName === replacementName(current, name) &&
        hashes.get(stray.id) === doc.sha256
    )
    if (replacement) {
      changes.finishes.push({ replacement, replaces: current })
      finished.add(replacement.id)
    } else {
      changes.uploads.push({ name, doc, replaces: current })
    }
  }
  for (const stray of strays) {
    if (finished.has(stray.id)) continue
    changes.discards.push(stray)
    changes.fields.push(`docs/${stray.filename} (left by a stopped replace, removed)`)
  }
  for (const [name, current] of byName) {
    if (Object.hasOwn(decl.docs, name)) continue
    if (!managed.has(current.id)) {
      changes.diagnostics.push(
        kindFinding(
          KIND,
          key,
          'W_UNDECLARED',
          `Document "${name}" is in the knowledge base but not in docs/; it is kept.`
        )
      )
    } else if (ctx.allowDelete) {
      changes.deletes.push(current)
      changes.fields.push(`docs/${name} (delete)`)
    } else {
      changes.diagnostics.push(
        kindFinding(
          KIND,
          key,
          'E_APPLY_DELETE_NOT_ALLOWED',
          `docs/${name} is no longer declared; deleting the stored document needs --allow-delete.`,
          { hint: 'Pass --allow-delete to delete it, or restore the file to keep it.' }
        )
      )
    }
  }
  const reindexed = new Set([
    ...changes.uploads.flatMap((upload) => (upload.replaces ? [upload.replaces.id] : [])),
    ...changes.finishes.map((finish) => finish.replaces.id),
    ...changes.deletes.map((doc) => doc.id),
  ])
  // A finished replacement is already stored and indexed, so it keeps its chunks too.
  const keepingChunks =
    [...byName.values()].filter((doc) => !reindexed.has(doc.id)).length + changes.finishes.length
  changes.diagnostics.push(
    ...indexingFindings(key, changes.uploads, chunkingChanged, keepingChunks)
  )
  return changes
}
