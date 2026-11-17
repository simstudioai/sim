/**
 * Knowledge bases as workspace source: `knowledge/<key>/knowledge.ts` declares the settings and
 * each file in `knowledge/<key>/docs/` is a document, synced by SHA-256. Every write goes through
 * the knowledge use cases (`createKnowledgeBase`, `updateKnowledgeBaseOperation`,
 * `deleteKnowledgeBaseOperation`, `uploadKnowledgeDocument`, `deleteKnowledgeDocument`), so their
 * authorization, billing admission, audit and indexing apply. An uploaded document is handed to
 * indexing as the upload use case hands it (see `relayKnowledgeDocumentProcessing`); an apply and
 * a get report the documents still indexing or failed. Connector-synced documents are never read,
 * printed, replaced or deleted.
 */
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { compareStrings } from '@sim/utils/string'
import { fingerprintOf, resourceAddress } from '@sim/workspace-code'
import {
  type KnowledgeBaseDecl,
  knowledgeCodec,
  knowledgeDocPath,
} from '@sim/workspace-code/kinds/knowledge'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  admitKnowledgeDocumentUpload,
  admitWorkspaceKnowledgeDocumentUpload,
  deleteKnowledgeDocument,
  uploadKnowledgeDocument,
} from '@/lib/knowledge/application/documents'
import { listKnowledgeFolders } from '@/lib/knowledge/application/folders'
import {
  createKnowledgeBase,
  deleteKnowledgeBaseOperation,
  listKnowledgeBases,
  readKnowledgeBase,
  updateKnowledgeBaseOperation,
} from '@/lib/knowledge/application/knowledge-bases'
import { getConfiguredKbEmbedding } from '@/lib/knowledge/embeddings'
import { getFileExtension } from '@/lib/uploads/utils/file'
import { isSupportedExtension, SUPPORTED_MIME_TYPES } from '@/lib/uploads/utils/validation'
import { admitOnce } from '@/lib/workspace-source/application/context'
import { isRefusal, refusalDiagnostic } from '@/lib/workspace-source/application/errors'
import {
  kindFinding,
  missingFolderFinding,
  nameHolder,
  nameTakenFinding,
  planUndeclared,
  refuseDeclaredTwice,
} from '@/lib/workspace-source/application/findings'
import { bindStored } from '@/lib/workspace-source/application/keys'
import {
  checkWrites,
  chunkingConfig,
  type DocUpload,
  diffKnowledgeBase,
  hashDocs,
  indexingFindings,
  type KnowledgeChanges,
} from '@/lib/workspace-source/application/kinds/knowledge/diff'
import {
  baseHashes,
  docRevision,
  hashableDocs,
  knowledgeView,
  loadDocs,
  movedTowardDecl,
  type StoredDoc,
  type StoredKnowledgeState,
  sourceDocs,
} from '@/lib/workspace-source/application/kinds/knowledge/stored'
import { holdsIn, resolveDeclared, settle } from '@/lib/workspace-source/application/three-way'
import type {
  AppliedResource,
  ApplyContext,
  KindAdapter,
  PlanContext,
  PlannedChange,
  SourceContext,
  StoredSet,
  WorkspaceSourceDiagnostic,
} from '@/lib/workspace-source/application/types'

/** What the apply carries out for one knowledge base, decided at plan time. */
interface KnowledgePlan {
  /** The changes a create, update or adopt makes; absent for a delete. */
  changes?: Pick<KnowledgeChanges, 'settings' | 'uploads' | 'deletes' | 'superseded'>
  /** Document id → SHA-256 for every stored document whose bytes the plan knows. */
  hashes: Map<string, string>
}

type KnowledgeChange = PlannedChange<KnowledgeBaseDecl, KnowledgePlan>

const KIND = 'knowledge-base'

const logger = createLogger('KnowledgeWorkspaceSource')

/** Re-reads one knowledge base through the read use case, refusing one that left the workspace. */
async function reload(ctx: SourceContext, id: string): Promise<StoredKnowledgeState> {
  const { knowledgeBase, folderPath } = await readKnowledgeBase.execute({
    principal: ctx.principal,
    input: { knowledgeBaseId: id, assertedWorkspaceId: ctx.workspace.workspaceId },
  })
  return { knowledgeBase, folderPath }
}

/** The paths of the documents a change uploads. */
function uploadPaths(key: string, uploads: readonly DocUpload[]): string[] {
  return uploads.map((upload) => knowledgeDocPath(key, upload.name))
}

/**
 * The finding a create gets about the embedding model: a declared model this server does not
 * create knowledge bases with, or a model the server cannot resolve at all (an unreachable
 * Ollama, say), which would otherwise fail the create partway through the apply.
 */
async function embeddingFinding(
  key: string,
  decl: KnowledgeBaseDecl,
  configured: () => ReturnType<typeof getConfiguredKbEmbedding>
): Promise<WorkspaceSourceDiagnostic | undefined> {
  let model: string
  try {
    model = (await configured()).model
  } catch (error) {
    if (isRefusal(error)) {
      return refusalDiagnostic(error, { kind: KIND, key })
    }
    logger.error('Embedding model unavailable while planning a knowledge base', {
      key,
      error: getErrorMessage(error),
    })
    return kindFinding(
      KIND,
      key,
      'E_APPLY_REFUSED',
      'This server cannot resolve its embedding model, so it cannot create knowledge bases right now.',
      { hint: 'Apply again once the embedding provider is reachable.' }
    )
  }
  if (decl.embeddingModel === undefined || decl.embeddingModel === model) return undefined
  return kindFinding(
    KIND,
    key,
    'E_KB_EMBEDDING_MODEL',
    `This server creates knowledge bases with ${model}, not ${decl.embeddingModel}.`,
    { hint: `Declare embeddingModel: '${model}', or leave it out.` }
  )
}

/** The finding for a name another stored knowledge base already holds. */
function nameTaken(
  key: string,
  name: string,
  stored: StoredSet<StoredKnowledgeState>,
  self?: string
): WorkspaceSourceDiagnostic[] {
  const holder = nameHolder(stored, name, { self })
  return holder ? [nameTakenFinding(KIND, key, name, holder)] : []
}

async function planKnowledgeBase(
  key: string,
  decl: KnowledgeBaseDecl,
  stored: StoredSet<StoredKnowledgeState>,
  ctx: PlanContext,
  folders: ReadonlySet<string>,
  configured: () => ReturnType<typeof getConfiguredKbEmbedding>
): Promise<KnowledgeChange> {
  const change: KnowledgeChange = { kind: KIND, key, action: 'noop', decl, diagnostics: [] }
  const missingFolder = missingFolderFinding(KIND, key, decl.folder, folders)
  if (missingFolder) change.diagnostics.push(missingFolder)
  const local = fingerprintOf(knowledgeCodec.canonical(decl))
  const base = ctx.base?.resources[resourceAddress(KIND, key)]
  const bound = stored.bound.get(key)
  const boundDocs = bound ? await loadDocs(ctx, bound.id) : []
  const based = bound && base?.id === bound.id && base.fingerprint ? base : undefined
  const hashes = baseHashes(boundDocs, based)
  // Set when the server moved only toward this directory since the base: plan from the base.
  let converged: string | undefined
  if (bound && based) {
    if (knowledgeView(bound.state, boundDocs, hashes).fingerprint !== based.fingerprint) {
      await hashDocs(ctx, bound.id, hashableDocs(boundDocs), hashes)
      if (movedTowardDecl({ decl, state: bound.state, docs: boundDocs, hashes, base: based })) {
        converged = based.fingerprint
      }
    }
  } else if (bound) {
    // Without a base for it, the stored documents the directory declares at the same size are
    // hashed, so a matching directory is a no-op; any other could never match.
    const comparable = [...sourceDocs(boundDocs).byName.values()].filter(
      (doc) =>
        Object.hasOwn(decl.docs, doc.filename) && decl.docs[doc.filename].size === doc.fileSize
    )
    await hashDocs(ctx, bound.id, comparable, hashes)
  }
  const resolution = resolveDeclared({
    local,
    stored: bound,
    adoptable: stored.unbound.find(
      (candidate) => candidate.name === decl.name && !candidate.state.knowledgeBase.isSearchIndex
    ),
    base,
    fingerprint: (resource) =>
      converged ?? knowledgeView(resource.state, boundDocs, hashes).fingerprint,
    holds: holdsIn(stored),
  })
  const target = 'stored' in resolution ? resolution.stored : undefined
  if (
    target &&
    decl.embeddingModel !== undefined &&
    decl.embeddingModel !== target.state.knowledgeBase.embeddingModel
  ) {
    change.diagnostics.push(
      kindFinding(
        KIND,
        key,
        'E_KB_EMBEDDING_IMMUTABLE',
        `"${target.name}" embeds with ${target.state.knowledgeBase.embeddingModel}; the model is fixed when a knowledge base is created.`,
        {
          hint: `Declare embeddingModel: '${target.state.knowledgeBase.embeddingModel}', or create a new knowledge base under another key.`,
        }
      )
    )
  }
  const planned = settle(
    resolution,
    change,
    (resource) => knowledgeView(resource.state, boundDocs, hashes).base
  )
  if ('settled' in planned) return planned.settled
  switch (planned.action) {
    case 'create': {
      change.diagnostics.push(...nameTaken(key, decl.name, stored))
      const embedding = await embeddingFinding(key, decl, configured)
      if (embedding) change.diagnostics.push(embedding)
      const uploads = Object.entries(decl.docs).map(([name, doc]) => ({ name, doc }))
      change.diagnostics.push(
        ...checkWrites(key, { chunking: chunkingConfig(decl.chunking), uploads }),
        ...indexingFindings(key, uploads, false, 0)
      )
      return {
        ...change,
        action: 'create',
        fields: uploads.map((upload) => `docs/${upload.name} (add)`),
        needsBlobs: uploadPaths(key, uploads),
        detail: {
          changes: { settings: {}, uploads, deletes: [], superseded: [] },
          hashes: new Map(),
        },
      }
    }
    case 'adopt':
    case 'update': {
      const resource = planned.stored
      const storedDocs = resource === bound ? boundDocs : await loadDocs(ctx, resource.id)
      const changes = await diffKnowledgeBase({
        key,
        decl,
        stored: resource,
        docs: storedDocs,
        hashes,
        ...(planned.action === 'update' ? { base: planned.base } : {}),
        ctx,
      })
      if (changes.settings.name !== undefined) {
        change.diagnostics.push(...nameTaken(key, changes.settings.name, stored, resource.id))
      }
      change.diagnostics.push(
        ...changes.diagnostics,
        ...checkWrites(key, { chunking: changes.settings.chunkingConfig, uploads: changes.uploads })
      )
      const changed =
        changes.fields.length > 0 || changes.uploads.length > 0 || changes.deletes.length > 0
      const view = knowledgeView(resource.state, storedDocs, hashes)
      // A server a partial apply already moved to the directory records its base as a no-op.
      const refreshed =
        planned.action === 'update' && !changed && view.fingerprint !== planned.base.fingerprint
      return {
        ...change,
        action: planned.action === 'adopt' ? 'adopt' : changed ? 'update' : 'noop',
        storedId: resource.id,
        ...(refreshed ? { base: view.base } : {}),
        ...(changes.fields.length > 0 ? { fields: changes.fields } : {}),
        ...(changes.deletes.length > 0
          ? { destructive: { what: 'documents', counts: { documents: changes.deletes.length } } }
          : {}),
        ...(changes.uploads.length > 0 ? { needsBlobs: uploadPaths(key, changes.uploads) } : {}),
        serverFingerprint: view.fingerprint,
        detail: { changes, hashes },
      }
    }
  }
}

/** One upload whose bytes this round carries. */
interface CarriedDoc {
  upload: DocUpload
  buffer: Buffer
}

/** The uploads whose bytes this round carries (checked against their hash when planned). */
function carriedDocs(ctx: ApplyContext, key: string, uploads: readonly DocUpload[]): CarriedDoc[] {
  const carried: CarriedDoc[] = []
  for (const upload of uploads) {
    const path = knowledgeDocPath(key, upload.name)
    const buffer = ctx.blobs?.content.get(path)
    if (buffer === undefined) continue
    carried.push({ upload, buffer })
  }
  return carried
}

async function deleteDoc(ctx: ApplyContext, knowledgeBaseId: string, documentId: string) {
  await deleteKnowledgeDocument.execute({
    principal: ctx.principal,
    input: { knowledgeBaseId, documentId, assertedWorkspaceId: ctx.workspace.workspaceId },
  })
}

/**
 * Deletes the document a replacement supersedes. When that fails, the replacement is deleted
 * again, as `upsertKnowledgeDocument` does, so a failed replace never leaves one name held twice;
 * an old document already gone counts as deleted.
 */
async function retire(
  ctx: ApplyContext,
  knowledgeBaseId: string,
  old: StoredDoc,
  replacementId: string
): Promise<void> {
  try {
    await deleteDoc(ctx, knowledgeBaseId, old.id)
  } catch (error) {
    if (error instanceof OrchestrationError && error.code === 'not_found') return
    try {
      await deleteDoc(ctx, knowledgeBaseId, replacementId)
    } catch (rollbackError) {
      logger.error('Failed to remove a replacement document after its replace failed', {
        knowledgeBaseId,
        documentId: replacementId,
        error: getErrorMessage(rollbackError),
      })
    }
    throw error
  }
}

/**
 * Uploads each carried document and deletes the document it replaces only once its replacement
 * is stored. Returns the new documents' hashes by id.
 */
async function uploadDocs(
  ctx: ApplyContext,
  knowledgeBaseId: string,
  carried: readonly CarriedDoc[]
): Promise<Map<string, string>> {
  const hashes = new Map<string, string>()
  for (const { upload, buffer } of carried) {
    const extension = getFileExtension(upload.name)
    const { document } = await uploadKnowledgeDocument.execute({
      principal: ctx.principal,
      input: {
        knowledgeBaseId,
        assertedWorkspaceId: ctx.workspace.workspaceId,
        file: {
          buffer,
          filename: upload.name,
          fileSize: buffer.byteLength,
          mimeType: isSupportedExtension(extension) ? SUPPORTED_MIME_TYPES[extension][0] : '',
        },
      },
    })
    hashes.set(document.id, upload.doc.sha256)
    if (upload.replaces) await retire(ctx, knowledgeBaseId, upload.replaces, document.id)
  }
  return hashes
}

/** Where a get's client downloads a document: the v2 document content route. */
function documentHref(ctx: SourceContext, knowledgeBaseId: string, documentId: string): string {
  const path = `/api/v2/knowledge/${encodeURIComponent(knowledgeBaseId)}/documents/${encodeURIComponent(documentId)}/content`
  return `${path}?workspaceId=${encodeURIComponent(ctx.workspace.workspaceId)}`
}

/**
 * What a get or apply reports about the indexing of `docs`: how many still wait for it or run it
 * (`I_KB_PROCESSING`), and which failed (`W_KB_DOC_FAILED`). Indexing state never reaches the
 * fingerprint, so a document finishing never makes the directory stale.
 */
function indexingStateFindings(
  key: string,
  name: string,
  docs: readonly StoredDoc[]
): WorkspaceSourceDiagnostic[] {
  const indexing = docs.filter(
    (doc) => doc.processingStatus === 'pending' || doc.processingStatus === 'processing'
  ).length
  const failed = docs.filter((doc) => doc.processingStatus === 'failed').map((doc) => doc.filename)
  const findings: WorkspaceSourceDiagnostic[] = []
  if (indexing > 0) {
    findings.push(
      kindFinding(
        KIND,
        key,
        'I_KB_PROCESSING',
        `${indexing} document(s) of "${name}" are still being indexed; search finds them once indexing completes.`,
        { hint: 'Run `sim workspaces source get` later to see their state.' }
      )
    )
  }
  if (failed.length > 0) {
    findings.push(
      kindFinding(
        KIND,
        key,
        'W_KB_DOC_FAILED',
        `${failed.length} document(s) of "${name}" failed to index and are not searchable: ${failed.sort(compareStrings).join(', ')}.`,
        { hint: 'Retry them from the knowledge base, or change the file and apply again.' }
      )
    )
  }
  return findings
}

/**
 * The stored knowledge base, its base entry and reprinted declaration after a write, with the
 * indexing state of the documents it uploaded (`uploaded` holds their ids).
 */
async function written(
  ctx: SourceContext,
  key: string,
  id: string,
  hashes: ReadonlyMap<string, string>,
  uploaded: ReadonlySet<string>
): Promise<AppliedResource> {
  const [state, docs] = await Promise.all([reload(ctx, id), loadDocs(ctx, id)])
  const view = knowledgeView(state, docs, hashes)
  const diagnostics = indexingStateFindings(
    key,
    state.knowledgeBase.name,
    docs.filter((doc) => uploaded.has(doc.id))
  )
  return {
    id,
    base: view.base,
    text: knowledgeCodec.print(key, view.decl).text,
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
  }
}

export const knowledgeAdapter: KindAdapter<KnowledgeBaseDecl, StoredKnowledgeState, KnowledgePlan> =
  {
    codec: knowledgeCodec,

    async load(ctx, { allocate }) {
      const { knowledgeBases } = await listKnowledgeBases.execute({
        principal: ctx.principal,
        input: { workspaceId: ctx.workspace.workspaceId },
      })
      const records = knowledgeBases.map((state) => ({
        id: state.knowledgeBase.id,
        name: state.knowledgeBase.name,
        state,
      }))
      // A search index is the workspace's own and never source; it only holds its name.
      return bindStored(ctx, KIND, records, {
        allocate,
        bindable: (record) => !record.state.knowledgeBase.isSearchIndex,
      })
    },

    async plan(desired, stored, ctx) {
      const { folders: listed } = await listKnowledgeFolders.execute({
        principal: ctx.principal,
        input: { workspaceId: ctx.workspace.workspaceId },
      })
      const folders = new Set(listed.map((folder) => folder.path))
      const changes: KnowledgeChange[] = []
      const declaredNames = new Map<string, string>()
      // The server's embedding model, resolved once for every create this plan makes.
      let embedding: ReturnType<typeof getConfiguredKbEmbedding> | undefined
      const configured = () => {
        embedding ??= getConfiguredKbEmbedding()
        return embedding
      }
      for (const [key, decl] of desired) {
        const change = await planKnowledgeBase(key, decl, stored, ctx, folders, configured)
        refuseDeclaredTwice(declaredNames, change, decl.name)
        changes.push(change)
      }
      // A delete is stale when the knowledge base changed on the server since the base; the
      // hashes the base vouches for are kept for the apply's `fingerprintNow` re-check.
      const undeclared = new Map<string, { fingerprint: string; hashes: Map<string, string> }>()
      if (ctx.allowDelete) {
        for (const [key, resource] of stored.bound) {
          const entry = ctx.base?.resources[resourceAddress(KIND, key)]
          if (desired.has(key) || entry?.id !== resource.id) continue
          const docs = await loadDocs(ctx, resource.id)
          const hashes = baseHashes(docs, entry)
          undeclared.set(resource.id, {
            fingerprint: knowledgeView(resource.state, docs, hashes).fingerprint,
            hashes,
          })
        }
      }
      const deletes = planUndeclared<StoredKnowledgeState, KnowledgeBaseDecl, KnowledgePlan>(
        KIND,
        desired,
        stored,
        ctx,
        {
          declared: changes,
          fingerprint: (resource) => undeclared.get(resource.id)?.fingerprint ?? '',
          counts: (resource) => ({ documents: resource.state.knowledgeBase.docCount }),
          detail: (resource) => {
            const hashes = undeclared.get(resource.id)?.hashes
            return hashes ? { hashes } : undefined
          },
        }
      )
      return [...changes, ...deletes]
    },

    async authorize(change, ctx) {
      const { principal } = ctx
      const workspaceId = ctx.workspace.workspaceId
      if (change.action === 'create' && change.decl) {
        await createKnowledgeBase.authorize({
          principal,
          input: { workspaceId, name: change.decl.name },
        })
        if (Object.keys(change.decl.docs).length > 0) {
          await admitOnce(ctx, 'knowledge-document:upload', () =>
            admitWorkspaceKnowledgeDocumentUpload.authorize({ principal, input: { workspaceId } })
          )
        }
        return
      }
      const knowledgeBaseId = change.storedId
      if (!knowledgeBaseId) return
      const scope = { knowledgeBaseId, assertedWorkspaceId: workspaceId }
      if (change.action === 'delete') {
        await deleteKnowledgeBaseOperation.authorize({ principal, input: scope })
        return
      }
      const changes = change.detail?.changes
      if (!changes) return
      if (Object.keys(changes.settings).length > 0) {
        await updateKnowledgeBaseOperation.authorize({ principal, input: scope })
      }
      if (changes.uploads.length > 0) {
        await admitKnowledgeDocumentUpload.authorize({ principal, input: scope })
      }
      const removed =
        changes.deletes[0] ??
        changes.superseded[0] ??
        changes.uploads.find((upload) => upload.replaces)?.replaces
      if (removed) {
        await deleteKnowledgeDocument.authorize({
          principal,
          input: { ...scope, documentId: removed.id },
        })
      }
    },

    async fingerprintNow(change, ctx) {
      const id = change.storedId
      if (!id) throw new Error('A knowledge base check needs the stored id')
      const [current, docs] = await Promise.all([reload(ctx, id), loadDocs(ctx, id)])
      return knowledgeView(current, docs, change.detail?.hashes ?? new Map()).fingerprint
    },

    async apply(change, ctx) {
      const { principal } = ctx
      const workspaceId = ctx.workspace.workspaceId
      if (change.action === 'delete') {
        if (!change.storedId) throw new Error('A knowledge base delete needs the stored id')
        await deleteKnowledgeBaseOperation.execute({
          principal,
          input: { knowledgeBaseId: change.storedId, assertedWorkspaceId: workspaceId },
        })
        return { id: change.storedId, text: {} }
      }
      const decl = change.decl
      const plan = change.detail
      if (!decl || !plan?.changes) throw new Error('A knowledge base write needs its plan')
      const carried = carriedDocs(ctx, change.key, plan.changes.uploads)
      if (change.action === 'create') {
        const { knowledgeBase } = await createKnowledgeBase.execute({
          principal,
          input: {
            workspaceId,
            name: decl.name,
            ...(decl.description !== undefined ? { description: decl.description } : {}),
            ...(decl.folder !== undefined ? { folderPath: decl.folder } : {}),
            chunkingConfig: chunkingConfig(decl.chunking),
          },
        })
        const uploaded = await uploadDocs(ctx, knowledgeBase.id, carried)
        return written(ctx, change.key, knowledgeBase.id, uploaded, new Set(uploaded.keys()))
      }
      const knowledgeBaseId = change.storedId
      if (!knowledgeBaseId) throw new Error('A knowledge base update needs the stored id')
      const { settings, deletes, superseded } = plan.changes
      if (Object.keys(settings).length > 0) {
        await updateKnowledgeBaseOperation.execute({
          principal,
          input: { knowledgeBaseId, assertedWorkspaceId: workspaceId, ...settings },
        })
      }
      const uploaded = await uploadDocs(ctx, knowledgeBaseId, carried)
      for (const doc of superseded) await deleteDoc(ctx, knowledgeBaseId, doc.id)
      // Deletes wait for the round that carries every blob, so a resumed apply loses nothing.
      if (ctx.blobs?.complete !== false) {
        for (const doc of deletes) await deleteDoc(ctx, knowledgeBaseId, doc.id)
      }
      return written(
        ctx,
        change.key,
        knowledgeBaseId,
        new Map([...plan.hashes, ...uploaded]),
        new Set(uploaded.keys())
      )
    },

    async read(stored, ctx) {
      const docs = await loadDocs(ctx, stored.id)
      const { byName, unmanaged } = sourceDocs(docs)
      const hashes = new Map<string, string>()
      const unhashed = await hashDocs(ctx, stored.id, byName.values(), hashes)
      const view = knowledgeView(stored.state, docs, hashes)
      const printed = knowledgeCodec.print(stored.key, view.decl)
      const left = unmanaged + byName.size - hashes.size - unhashed.length
      const diagnostics = indexingStateFindings(stored.key, stored.name, [...byName.values()])
      if (unhashed.length > 0) {
        diagnostics.push(
          kindFinding(
            KIND,
            stored.key,
            'I_KB_DOCS_UNHASHED',
            `${unhashed.length} document(s) of "${stored.name}" are listed without a hash: this get reached its download budget, or could not read their bytes.`
          )
        )
      }
      if (left > 0) {
        diagnostics.push(
          kindFinding(
            KIND,
            stored.key,
            'I_KB_UNMANAGED_DOCS',
            `${left} document(s) of "${stored.name}" are not part of source (connector-synced, too large, unreadable, or sharing a file name) and are left as they are.`
          )
        )
      }
      return {
        text: printed.text,
        blobs: [
          ...printed.blobs.flatMap((blob) => {
            const doc = byName.get(blob.path.slice(knowledgeDocPath(stored.key, '').length))
            return doc ? [{ ...blob, id: doc.id, href: documentHref(ctx, stored.id, doc.id) }] : []
          }),
          ...unhashed.map((doc) => ({
            path: knowledgeDocPath(stored.key, doc.filename),
            size: doc.fileSize,
            id: doc.id,
            href: documentHref(ctx, stored.id, doc.id),
            rev: String(docRevision(doc)),
          })),
        ],
        base: view.base,
        ...(diagnostics.length > 0 ? { diagnostics } : {}),
      }
    },
  }
