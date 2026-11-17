/**
 * What applying a knowledge base declaration changes: its settings (name, description, folder,
 * chunking) and its documents, each kept, uploaded, replaced or deleted by file name and hash.
 * A replace is an upload followed by a delete of the old document, never an in-place edit, since
 * the knowledge use cases have none (`upsertKnowledgeDocument` creates a new document too). The
 * replacement therefore has a new id and none of the old one's tag values.
 */
import { sha256Hex } from '@sim/security/hash'
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
import { getFileExtension } from '@/lib/uploads/utils/file'
import { isSupportedExtension } from '@/lib/uploads/utils/validation'
import {
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
  deletes: StoredDoc[]
  fields: string[]
  diagnostics: WorkspaceSourceDiagnostic[]
}

export function finding(
  key: string,
  code: string,
  message: string,
  hint?: string
): WorkspaceSourceDiagnostic {
  return {
    code,
    severity: code.startsWith('E_') ? 'error' : code.startsWith('W_') ? 'warning' : 'info',
    message,
    ...(hint ? { hint } : {}),
    kind: 'knowledge-base',
    key,
  }
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

/** The checks a declaration fails whether it creates or updates: chunking bounds, document types. */
export function checkDeclaration(
  key: string,
  decl: KnowledgeBaseDecl
): WorkspaceSourceDiagnostic[] {
  const diagnostics: WorkspaceSourceDiagnostic[] = []
  const chunking = chunkingConfigSchema.safeParse(chunkingConfig(decl.chunking))
  if (!chunking.success) {
    diagnostics.push(
      finding(
        key,
        'E_KB_CHUNKING',
        `The chunking settings are invalid: ${chunking.error.issues.map((issue) => issue.message).join('; ')}.`
      )
    )
  }
  for (const [name, doc] of Object.entries(decl.docs)) {
    if (!isSupportedExtension(getFileExtension(name))) {
      diagnostics.push(
        finding(
          key,
          'E_KB_DOC_NAME',
          `docs/${name} is not a document type a knowledge base indexes.`,
          'Use a supported extension such as .md, .txt, .pdf, .docx or .csv.'
        )
      )
    } else if (doc.size === 0) {
      diagnostics.push(finding(key, 'E_KB_DOC_NAME', `docs/${name} is empty.`))
    }
  }
  return diagnostics
}

/**
 * The SHA-256 of a stored document's bytes, read through the original-document use case, or
 * `undefined` when its bytes are unavailable.
 */
async function hashStoredDoc(
  ctx: SourceContext,
  knowledgeBaseId: string,
  documentId: string
): Promise<string | undefined> {
  const original = await readOriginalKnowledgeDocument.execute({
    principal: ctx.principal,
    input: {
      knowledgeBaseId,
      documentId,
      assertedWorkspaceId: ctx.workspace.workspaceId,
      maxBytes: WORKSPACE_SOURCE_LIMITS.maxBlobBytes,
    },
  })
  return original.sourceAvailable ? sha256Hex(original.buffer) : undefined
}

/** The hashes of every document source manages, downloaded one at a time. */
export async function hashDocs(
  ctx: SourceContext,
  knowledgeBaseId: string,
  docs: readonly StoredDoc[]
): Promise<Map<string, string>> {
  const hashes = new Map<string, string>()
  for (const doc of sourceDocs(docs).byName.values()) {
    const sha256 = await hashStoredDoc(ctx, knowledgeBaseId, doc.id)
    if (sha256 !== undefined) hashes.set(doc.id, sha256)
  }
  return hashes
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
        'I_KB_REEMBED',
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
 * Only a document the base records (`managed`) is deleted when undeclared; any other is kept.
 */
export async function diffKnowledgeBase(input: {
  key: string
  decl: KnowledgeBaseDecl
  stored: StoredKnowledgeBase
  docs: readonly StoredDoc[]
  hashes: Map<string, string>
  managed: ReadonlySet<string>
  ctx: PlanContext
}): Promise<KnowledgeChanges> {
  const { key, decl, stored, docs, hashes, ctx } = input
  const { knowledgeBase, folderPath } = stored.state
  const changes: KnowledgeChanges = {
    settings: {},
    uploads: [],
    deletes: [],
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
    if (ambiguous.has(name)) {
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
    let sha256 = hashes.get(current.id)
    if (sha256 === undefined) {
      sha256 = await hashStoredDoc(ctx, stored.id, current.id)
      if (sha256 !== undefined) hashes.set(current.id, sha256)
    }
    if (sha256 === doc.sha256) continue
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
