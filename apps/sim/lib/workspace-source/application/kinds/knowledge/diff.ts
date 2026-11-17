/**
 * What applying a knowledge base declaration changes: its settings (name, description, folder,
 * chunking) and its documents, each kept, uploaded, replaced or deleted by file name and hash.
 * A replace is an upload followed by a delete of the old document, never an in-place edit, since
 * the knowledge use cases have none (`upsertKnowledgeDocument` creates a new document too). The
 * replacement therefore has a new id and none of the old one's tag values.
 */
import { sha256Hex } from '@sim/security/hash'
import type { BaseResource, WorkspaceDiagnosticCode } from '@sim/workspace-code'
import type {
  KnowledgeBaseDecl,
  KnowledgeChunkingDecl,
  KnowledgeDocDecl,
} from '@sim/workspace-code/kinds/knowledge'
import { WORKSPACE_SOURCE_LIMITS } from '@sim/workspace-code/limits'
import { chunkingConfigSchema } from '@/lib/api/contracts/knowledge/base'
import { readOriginalKnowledgeDocument } from '@/lib/knowledge/application/read-original-document'
import { DEFAULT_CHUNKING_CONFIG } from '@/lib/knowledge/constants'
import type { ChunkingConfig } from '@/lib/knowledge/types'
import { validateFileType } from '@/lib/uploads/utils/validation'
import { kindFinding } from '@/lib/workspace-source/application/findings'
import {
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

/** A finding about one knowledge base. */
export function finding(
  key: string,
  code: WorkspaceDiagnosticCode,
  message: string,
  hint?: string
): WorkspaceSourceDiagnostic {
  return kindFinding('knowledge-base', key, code, message, hint)
}

/** The full chunking settings a declaration resolves to. */
export function chunkingConfig(chunking: KnowledgeChunkingDecl | undefined): ChunkingConfig {
  return {
    maxSize: chunking?.maxSize ?? DEFAULT_CHUNKING_CONFIG.maxSize,
    minSize: chunking?.minSize ?? DEFAULT_CHUNKING_CONFIG.minSize,
    overlap: chunking?.overlap ?? DEFAULT_CHUNKING_CONFIG.overlap,
    ...(chunking?.strategy !== undefined ? { strategy: chunking.strategy } : {}),
    ...(chunking?.strategyOptions !== undefined
      ? { strategyOptions: chunking.strategyOptions }
      : {}),
  }
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
      finding(
        key,
        'E_KB_CHUNKING',
        `The chunking settings are invalid: ${chunking.error.issues.map((issue) => issue.message).join('; ')}.`
      )
    )
  }
  for (const { name, doc } of writes.uploads) {
    const typeError = validateFileType(name, '')
    if (typeError) {
      diagnostics.push(finding(key, 'E_KB_DOC_NAME', `docs/${name}: ${typeError.message}`))
    } else if (doc.size === 0) {
      diagnostics.push(finding(key, 'E_KB_DOC_EMPTY', `docs/${name} is empty.`))
    }
  }
  return diagnostics
}

/** What one request may download to hash stored documents; past it, documents stay unhashed. */
const HASH_BUDGET = { bytes: WORKSPACE_SOURCE_LIMITS.maxBlobBytesPerRequest, docs: 200 }

/** The hashing each request (a get, or one apply round's plan) has spent so far. */
const hashSpend = new WeakMap<SourceContext, { bytes: number; docs: number }>()

/** Charges one document's download to the request's budget; `false` once it would overrun. */
function chargeHash(ctx: SourceContext, bytes: number): boolean {
  const spent = hashSpend.get(ctx) ?? { bytes: 0, docs: 0 }
  if (spent.docs >= HASH_BUDGET.docs || spent.bytes + bytes > HASH_BUDGET.bytes) return false
  hashSpend.set(ctx, { bytes: spent.bytes + bytes, docs: spent.docs + 1 })
  return true
}

/**
 * Downloads and hashes each of `docs` whose hash `hashes` lacks, through the original-document
 * use case, adding it to `hashes`. A document whose bytes are gone stays unhashed. Returns the
 * documents left unhashed because the request's download budget ran out.
 */
export async function hashDocs(
  ctx: SourceContext,
  knowledgeBaseId: string,
  docs: Iterable<StoredDoc>,
  hashes: Map<string, string>
): Promise<StoredDoc[]> {
  const unbudgeted: StoredDoc[] = []
  for (const doc of docs) {
    if (hashes.has(doc.id)) continue
    if (!chargeHash(ctx, doc.fileSize)) {
      unbudgeted.push(doc)
      continue
    }
    const original = await readOriginalKnowledgeDocument.execute({
      principal: ctx.principal,
      input: {
        knowledgeBaseId,
        documentId: doc.id,
        assertedWorkspaceId: ctx.workspace.workspaceId,
        maxBytes: WORKSPACE_SOURCE_LIMITS.maxBlobBytes,
      },
    })
    if (original.sourceAvailable) hashes.set(doc.id, sha256Hex(original.buffer))
  }
  return unbudgeted
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
      finding(
        key,
        'I_KB_REEMBED',
        `Indexes ${uploads.length} document(s) (${uploads.length - replaced} new, ${replaced} replaced); embedding runs in the background after the apply.`
      )
    )
  }
  if (chunkingChanged && storedDocs > 0) {
    findings.push(
      finding(
        key,
        'I_KB_CHUNKING',
        `New chunking applies to documents indexed from now on; ${storedDocs} stored document(s) keep their chunks.`,
        'Replace a document to index it again.'
      )
    )
  }
  return findings
}

/**
 * Diffs a declaration against a stored knowledge base and its documents. `hashes` holds the
 * document hashes known so far (from the base); a declared document whose stored hash is unknown
 * is downloaded and hashed, so an unchanged document is never re-embedded, and the hash is added.
 * One the request's download budget leaves unhashed is neither uploaded nor deleted, only named.
 * Only a document the base records (`managed`) is deleted when undeclared; any other is kept. A
 * name held twice is settled when `base` shows a replace that stopped before its delete.
 */
export async function diffKnowledgeBase(input: {
  key: string
  decl: KnowledgeBaseDecl
  stored: StoredKnowledgeBase
  docs: readonly StoredDoc[]
  hashes: Map<string, string>
  managed: ReadonlySet<string>
  base?: BaseResource
  ctx: PlanContext
}): Promise<KnowledgeChanges> {
  const { key, decl, stored, docs, hashes, base, ctx } = input
  const { knowledgeBase, folderPath } = stored.state
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
  for (const [name, doc] of Object.entries(decl.docs)) {
    const holders = ambiguous.get(name)
    if (holders) {
      if (base && holders.length === 2) await hashDocs(ctx, stored.id, holders, hashes)
      const superseded = supersededDuplicate(holders, hashes, base, doc.sha256)
      if (superseded) {
        changes.superseded.push(superseded)
        changes.fields.push(`docs/${name} (replace)`)
        continue
      }
      changes.diagnostics.push(
        finding(
          key,
          'E_KB_DOC_AMBIGUOUS',
          `Several stored documents are named "${name}", so docs/${name} cannot tell which one it is.`,
          'Delete or rename the duplicates in the knowledge base, then get and apply again.'
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
    const [unchecked] = await hashDocs(ctx, stored.id, [current], hashes)
    if (unchecked) {
      changes.diagnostics.push(
        finding(
          key,
          'W_KB_DOC_UNCHECKED',
          `docs/${name} was not compared with the stored document: this request reached its download budget, so it is left as it is.`,
          'Apply again to compare it.'
        )
      )
      continue
    }
    if (hashes.get(current.id) === doc.sha256) continue
    changes.uploads.push({ name, doc, replaces: current })
    changes.fields.push(`docs/${name} (replace)`)
    if (current.tagged) {
      changes.diagnostics.push(
        finding(
          key,
          'W_KB_DOC_TAGS',
          `Replacing docs/${name} uploads a new document; the stored one's tag values are not carried over.`,
          'Set the tags again on the new document after the apply.'
        )
      )
    }
  }
  for (const [name, current] of byName) {
    if (Object.hasOwn(decl.docs, name)) continue
    if (!input.managed.has(current.id)) {
      changes.diagnostics.push(
        finding(
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
        finding(
          key,
          'E_APPLY_DELETE_NOT_ALLOWED',
          `docs/${name} is no longer declared; deleting the stored document needs --allow-delete.`,
          'Pass --allow-delete to delete it, or restore the file to keep it.'
        )
      )
    }
  }
  changes.diagnostics.push(...indexingFindings(key, changes.uploads, chunkingChanged, byName.size))
  return changes
}
