/**
 * What applying a knowledge base declaration changes: its settings (name, description, folder,
 * chunking) and its documents, each kept, uploaded, replaced or deleted by file name and hash.
 * A replace is an upload followed by a delete of the old document, never an in-place edit, since
 * the knowledge use cases have none (`upsertKnowledgeDocument` creates a new document too). The
 * replacement therefore has a new id and none of the old one's tag values.
 */
import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
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
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { readOriginalKnowledgeDocument } from '@/lib/knowledge/application/read-original-document'
import type { ChunkingConfig } from '@/lib/knowledge/types'
import { validateFileType } from '@/lib/uploads/utils/validation'
import { kindFinding } from '@/lib/workspace-source/application/findings'
import { HASH_CONCURRENCY, takeHashBudget } from '@/lib/workspace-source/application/hash-budget'
import {
  baseHashes,
  type StoredDoc,
  type StoredKnowledgeBase,
  sameChunking,
  sourceDocs,
  storedChunking,
  supersededDuplicate,
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
  /** Replaced documents still stored beside their replacement, deleted to finish the replace. */
  superseded: StoredDoc[]
  fields: string[]
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
 * Downloads and hashes each of `docs` whose hash `hashes` lacks, through the original-document
 * use case, adding it to `hashes`: the request's budget is spent in order first, then the
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
  for (const doc of docs) if (!hashes.has(doc.id)) unknown.set(doc.id, doc)
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
      return original.sourceAvailable ? sha256Hex(original.buffer) : null
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

/** The info line a change gets for the documents it indexes, and for chunking it changes. */
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
 * records (an update's `base`) is deleted when undeclared; any other is kept. A name held twice is
 * settled when `base` shows a replace that stopped before its delete.
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
  const managed = new Set(base ? baseHashes(docs, base).keys() : [])
  const changes: KnowledgeChanges = {
    settings: {},
    uploads: [],
    deletes: [],
    superseded: [],
    fields: [],
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

  const { byName, ambiguous } = sourceDocs(docs)
  const comparable: StoredDoc[] = []
  for (const [name, doc] of Object.entries(decl.docs)) {
    const holders = ambiguous.get(name)
    const current = byName.get(name)
    if (holders && base && holders.length === 2) comparable.push(...holders)
    else if (current && current.fileSize === doc.size) comparable.push(current)
  }
  const unchecked = new Set(
    (await hashDocs(ctx, stored.id, comparable, hashes)).map((doc) => doc.id)
  )
  for (const [name, doc] of Object.entries(decl.docs)) {
    const holders = ambiguous.get(name)
    if (holders) {
      const superseded = supersededDuplicate(holders, hashes, base, doc.sha256)
      if (superseded) {
        changes.superseded.push(superseded)
        changes.fields.push(`docs/${name} (replace)`)
        continue
      }
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
      changes.uploads.push({ name, doc })
      changes.fields.push(`docs/${name} (add)`)
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
    if (hashes.get(current.id) === doc.sha256) continue
    changes.uploads.push({ name, doc, replaces: current })
    changes.fields.push(`docs/${name} (replace)`)
    if (current.tagged) {
      changes.diagnostics.push(
        kindFinding(
          KIND,
          key,
          'W_KB_DOC_TAGS',
          `Replacing docs/${name} uploads a new document; the stored one's tag values are not carried over.`,
          { hint: 'Set the tags again on the new document after the apply.' }
        )
      )
    }
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
  changes.diagnostics.push(...indexingFindings(key, changes.uploads, chunkingChanged, byName.size))
  return changes
}
