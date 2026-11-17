/**
 * Knowledge bases as workspace source: `knowledge/<key>/knowledge.ts` declares the settings and
 * each file in `knowledge/<key>/docs/` is a document, synced by SHA-256. Every write goes through
 * the knowledge use cases (`createKnowledgeBase`, `updateKnowledgeBaseOperation`,
 * `deleteKnowledgeBaseOperation`, `uploadKnowledgeDocument`, `deleteKnowledgeDocument`), so their
 * authorization, billing admission, audit and indexing apply. Indexing stays asynchronous: an
 * apply returns once the documents are stored. Connector-synced documents are never read,
 * printed, replaced or deleted.
 */
import { db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
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
import { ResourceChangedError, refusalDiagnostic } from '@/lib/workspace-source/application/errors'
import {
  noBaseFinding,
  planUndeclared,
  serverChangedFinding,
  serverGoneFinding,
  staleFinding,
} from '@/lib/workspace-source/application/findings'
import {
  checkWrites,
  chunkingConfig,
  type DocUpload,
  diffKnowledgeBase,
  finding,
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
  type StoredKnowledgeBase,
  type StoredKnowledgeState,
  sourceDocs,
} from '@/lib/workspace-source/application/kinds/knowledge/stored'
import { holdsIn, resolveDeclared } from '@/lib/workspace-source/application/three-way'
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
import { claimResourceKey, readKeysByResource, resolveKeys } from '@/lib/workspaces/resource-keys'

/** What the apply carries out for one knowledge base, decided at plan time. */
interface KnowledgePlan {
  changes: Pick<KnowledgeChanges, 'settings' | 'uploads' | 'deletes' | 'superseded'>
  /** Document id → SHA-256 for every stored document whose bytes the plan knows. */
  hashes: Map<string, string>
  /** The stored knowledge base's fingerprint under `hashes` when planned; absent for a create. */
  serverFingerprint?: string
}

type KnowledgeChange = PlannedChange<KnowledgeBaseDecl, KnowledgePlan>

const KIND = 'knowledge-base'

const logger = createLogger('KnowledgeWorkspaceSource')

function storedKnowledgeBase(key: string, state: StoredKnowledgeState): StoredKnowledgeBase {
  return { key, id: state.knowledgeBase.id, name: state.knowledgeBase.name, state }
}

/** Re-reads one knowledge base through the read use case, refusing one that left the workspace. */
async function reload(ctx: SourceContext, key: string, id: string): Promise<StoredKnowledgeBase> {
  const { knowledgeBase, folderPath } = await readKnowledgeBase.execute({
    principal: ctx.principal,
    input: { knowledgeBaseId: id, assertedWorkspaceId: ctx.workspace.workspaceId },
  })
  return storedKnowledgeBase(key, { knowledgeBase, folderPath })
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
  decl: KnowledgeBaseDecl
): Promise<WorkspaceSourceDiagnostic | undefined> {
  let model: string
  try {
    model = (await getConfiguredKbEmbedding()).model
  } catch (error) {
    if (error instanceof OrchestrationError && error.code !== 'internal') {
      return refusalDiagnostic(error, { kind: KIND, key })
    }
    logger.error('Embedding model unavailable while planning a knowledge base', {
      key,
      error: getErrorMessage(error),
    })
    return finding(
      key,
      'E_APPLY_REFUSED',
      'This server cannot resolve its embedding model, so it cannot create knowledge bases right now.',
      'Apply again once the embedding provider is reachable.'
    )
  }
  if (decl.embeddingModel === undefined || decl.embeddingModel === model) return undefined
  return finding(
    key,
    'E_KB_EMBEDDING_MODEL',
    `This server creates knowledge bases with ${model}, not ${decl.embeddingModel}.`,
    `Declare embeddingModel: '${model}', or leave it out.`
  )
}

/** The finding for a name another stored knowledge base already holds. */
function nameTakenFinding(
  key: string,
  name: string,
  stored: StoredSet<StoredKnowledgeState>,
  self?: string
): WorkspaceSourceDiagnostic | undefined {
  const holder = [...stored.bound.values(), ...stored.unbound].find(
    (candidate) => candidate.name === name && candidate.id !== self
  )
  if (!holder) return undefined
  return finding(
    key,
    'E_NAME_TAKEN',
    holder.key
      ? `The knowledge base name "${name}" belongs to the knowledge base under key "${holder.key}".`
      : `A knowledge base this directory cannot manage is already named "${name}".`,
    'Rename one of them, or declare that knowledge base under its own key.'
  )
}

async function planKnowledgeBase(
  key: string,
  decl: KnowledgeBaseDecl,
  stored: StoredSet<StoredKnowledgeState>,
  ctx: PlanContext,
  folders: ReadonlySet<string>
): Promise<KnowledgeChange> {
  const change: KnowledgeChange = { kind: KIND, key, action: 'noop', decl, diagnostics: [] }
  if (decl.folder && decl.folder !== '/' && !folders.has(decl.folder)) {
    change.diagnostics.push(
      finding(
        key,
        'E_KB_FOLDER',
        `The folder ${decl.folder} does not exist in this workspace.`,
        'Create the folder first, or drop `folder` to keep the knowledge base at the root.'
      )
    )
  }
  const local = fingerprintOf(knowledgeCodec.canonical(decl))
  const base = ctx.base?.resources[resourceAddress(KIND, key)]
  const bound = stored.bound.get(key)
  const boundDocs = bound ? await loadDocs(ctx, bound.id) : []
  const based = bound && base?.id === bound.id && base.fingerprint ? base : undefined
  const hashes = baseHashes(boundDocs, based)
  /** Set when the server moved only toward this directory since the base: planned from the base. */
  let converged: string | undefined
  if (bound && based) {
    if (knowledgeView(bound, boundDocs, hashes).fingerprint !== based.fingerprint) {
      await hashDocs(ctx, bound.id, hashableDocs(boundDocs), hashes)
      if (movedTowardDecl({ decl, stored: bound, docs: boundDocs, hashes, base: based })) {
        converged = based.fingerprint
      }
    }
  } else if (bound) {
    /** Without a base for it, the stored documents are hashed so a matching directory is a no-op. */
    await hashDocs(ctx, bound.id, sourceDocs(boundDocs).byName.values(), hashes)
  }
  const resolution = resolveDeclared({
    local,
    stored: bound,
    adoptable: stored.unbound.find(
      (candidate) => candidate.name === decl.name && !candidate.state.knowledgeBase.isSearchIndex
    ),
    base,
    fingerprint: (resource) => converged ?? knowledgeView(resource, boundDocs, hashes).fingerprint,
    holds: holdsIn(stored),
  })
  const target = 'stored' in resolution ? resolution.stored : undefined
  if (
    target &&
    decl.embeddingModel !== undefined &&
    decl.embeddingModel !== target.state.knowledgeBase.embeddingModel
  ) {
    change.diagnostics.push(
      finding(
        key,
        'E_KB_EMBEDDING_IMMUTABLE',
        `"${target.name}" embeds with ${target.state.knowledgeBase.embeddingModel}; the model is fixed when a knowledge base is created.`,
        `Declare embeddingModel: '${target.state.knowledgeBase.embeddingModel}', or create a new knowledge base under another key.`
      )
    )
  }
  switch (resolution.action) {
    case 'deleted':
      change.diagnostics.push(serverGoneFinding(KIND, key, resolution.stale))
      return change
    case 'stale':
      change.diagnostics.push(staleFinding(KIND, key))
      return { ...change, storedId: resolution.stored.id }
    case 'no-base':
      change.diagnostics.push(noBaseFinding(KIND, key))
      return { ...change, storedId: resolution.stored.id }
    case 'noop': {
      if (resolution.serverChanged) change.diagnostics.push(serverChangedFinding(KIND, key))
      return {
        ...change,
        storedId: resolution.stored.id,
        ...(resolution.refreshed
          ? { base: knowledgeView(resolution.stored, boundDocs, hashes).base }
          : {}),
      }
    }
    case 'create': {
      const taken = nameTakenFinding(key, decl.name, stored)
      if (taken) change.diagnostics.push(taken)
      const embedding = await embeddingFinding(key, decl)
      if (embedding) change.diagnostics.push(embedding)
      ctx.pending.push({ kind: KIND, key, id: generateId() })
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
        partialBlobs: true,
        detail: {
          changes: { settings: {}, uploads, deletes: [], superseded: [] },
          hashes: new Map(),
        },
      }
    }
    case 'adopt':
    case 'update': {
      const resource = resolution.stored
      const storedDocs = resource === bound ? boundDocs : await loadDocs(ctx, resource.id)
      const changes = await diffKnowledgeBase({
        key,
        decl,
        stored: resource,
        docs: storedDocs,
        hashes,
        managed: new Set(
          resolution.action === 'update' ? baseHashes(storedDocs, resolution.base).keys() : []
        ),
        ...(resolution.action === 'update' ? { base: resolution.base } : {}),
        ctx,
      })
      const renamed =
        changes.settings.name !== undefined &&
        nameTakenFinding(key, changes.settings.name, stored, resource.id)
      if (renamed) change.diagnostics.push(renamed)
      change.diagnostics.push(
        ...changes.diagnostics,
        ...checkWrites(key, { chunking: changes.settings.chunkingConfig, uploads: changes.uploads })
      )
      const changed =
        changes.fields.length > 0 || changes.uploads.length > 0 || changes.deletes.length > 0
      const view = knowledgeView(resource, storedDocs, hashes)
      /** A server a partial apply already moved to the directory records its base as a no-op. */
      const refreshed =
        resolution.action === 'update' &&
        !changed &&
        view.fingerprint !== resolution.base.fingerprint
      return {
        ...change,
        action: resolution.action === 'adopt' ? 'adopt' : changed ? 'update' : 'noop',
        storedId: resource.id,
        ...(refreshed ? { base: view.base } : {}),
        ...(changes.fields.length > 0 ? { fields: changes.fields } : {}),
        ...(changes.deletes.length > 0
          ? { destructive: { what: 'documents', counts: { documents: changes.deletes.length } } }
          : {}),
        ...(changes.uploads.length > 0
          ? { needsBlobs: uploadPaths(key, changes.uploads), partialBlobs: true }
          : {}),
        detail: { changes, hashes, serverFingerprint: view.fingerprint },
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

/** The stored knowledge base, its base entry and reprinted declaration after a write. */
/** Where a get's client downloads a document: the v2 document content route. */
function documentHref(ctx: SourceContext, knowledgeBaseId: string, documentId: string): string {
  const path = `/api/v2/knowledge/${encodeURIComponent(knowledgeBaseId)}/documents/${encodeURIComponent(documentId)}/content`
  return `${path}?workspaceId=${encodeURIComponent(ctx.workspace.workspaceId)}`
}

async function written(
  ctx: SourceContext,
  key: string,
  id: string,
  hashes: ReadonlyMap<string, string>
): Promise<AppliedResource> {
  const resource = await reload(ctx, key, id)
  const view = knowledgeView(resource, await loadDocs(ctx, id), hashes)
  return { id, base: view.base, text: knowledgeCodec.print(key, view.decl).text }
}

export const knowledgeAdapter: KindAdapter<KnowledgeBaseDecl, StoredKnowledgeState, KnowledgePlan> =
  {
    codec: knowledgeCodec,

    async load(ctx, { allocate }) {
      const { workspaceId } = ctx.workspace
      const { knowledgeBases } = await listKnowledgeBases.execute({
        principal: ctx.principal,
        input: { workspaceId },
      })
      /** A search index is the workspace's own and never source; it only holds its name. */
      const sourced = knowledgeBases.filter((entry) => !entry.knowledgeBase.isSearchIndex)
      const ids = sourced.map((entry) => entry.knowledgeBase.id)
      const keys = allocate
        ? ((
            await resolveKeys(
              workspaceId,
              ids.map((id) => ({ kind: KIND, id })),
              { createdBy: ctx.createdBy }
            )
          ).get(KIND) ?? new Map<string, string>())
        : await readKeysByResource(db, workspaceId, KIND, ids)
      const set: StoredSet<StoredKnowledgeState> = { bound: new Map(), unbound: [] }
      for (const state of knowledgeBases) {
        const key = state.knowledgeBase.isSearchIndex ? undefined : keys.get(state.knowledgeBase.id)
        if (key === undefined) set.unbound.push(storedKnowledgeBase('', state))
        else set.bound.set(key, storedKnowledgeBase(key, state))
      }
      return set
    },

    async plan(desired, stored, ctx) {
      const { folders: listed } = await listKnowledgeFolders.execute({
        principal: ctx.principal,
        input: { workspaceId: ctx.workspace.workspaceId },
      })
      const folders = new Set(listed.map((folder) => folder.path))
      const changes: KnowledgeChange[] = []
      for (const [key, decl] of desired) {
        changes.push(await planKnowledgeBase(key, decl, stored, ctx, folders))
      }
      /** A delete is stale when the knowledge base changed on the server since the base. */
      const undeclared = new Map<string, string>()
      if (ctx.allowDelete) {
        for (const [key, resource] of stored.bound) {
          const entry = ctx.base?.resources[resourceAddress(KIND, key)]
          if (desired.has(key) || entry?.id !== resource.id) continue
          const docs = await loadDocs(ctx, resource.id)
          undeclared.set(
            resource.id,
            knowledgeView(resource, docs, baseHashes(docs, entry)).fingerprint
          )
        }
      }
      changes.push(
        ...planUndeclared<StoredKnowledgeState, KnowledgeBaseDecl, KnowledgePlan>(
          KIND,
          desired,
          stored,
          ctx,
          (resource) => ({
            what: 'knowledge base',
            counts: { documents: resource.state.knowledgeBase.docCount },
          }),
          {
            declared: changes,
            fingerprint: (resource) => undeclared.get(resource.id) ?? '',
          }
        )
      )
      return changes
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
          await admitWorkspaceKnowledgeDocumentUpload.authorize({
            principal,
            input: { workspaceId },
          })
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
      if (!decl || !plan) throw new Error('A knowledge base write needs its plan')
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
        /**
         * The key is claimed once the documents are stored: a create that fails before then
         * leaves an unbound knowledge base, which the next apply adopts by name and finishes.
         */
        await claimResourceKey({
          workspaceId,
          kind: KIND,
          key: change.key,
          resourceId: knowledgeBase.id,
          origin: 'created',
          createdBy: ctx.createdBy,
        })
        return written(ctx, change.key, knowledgeBase.id, uploaded)
      }
      const knowledgeBaseId = change.storedId
      if (!knowledgeBaseId) throw new Error('A knowledge base update needs the stored id')
      const current = await reload(ctx, change.key, knowledgeBaseId)
      const currentDocs = await loadDocs(ctx, knowledgeBaseId)
      if (knowledgeView(current, currentDocs, plan.hashes).fingerprint !== plan.serverFingerprint) {
        throw new ResourceChangedError(change)
      }
      if (change.action === 'adopt') {
        await claimResourceKey({
          workspaceId,
          kind: KIND,
          key: change.key,
          resourceId: knowledgeBaseId,
          origin: 'adopted',
          createdBy: ctx.createdBy,
        })
      }
      const { settings, deletes, superseded } = plan.changes
      if (Object.keys(settings).length > 0) {
        await updateKnowledgeBaseOperation.execute({
          principal,
          input: { knowledgeBaseId, assertedWorkspaceId: workspaceId, ...settings },
        })
      }
      const uploaded = await uploadDocs(ctx, knowledgeBaseId, carried)
      for (const doc of superseded) await deleteDoc(ctx, knowledgeBaseId, doc.id)
      /** Deletes wait for the round that carries every blob, so a resumed apply loses nothing. */
      if (ctx.blobs?.complete !== false) {
        for (const doc of deletes) await deleteDoc(ctx, knowledgeBaseId, doc.id)
      }
      return written(ctx, change.key, knowledgeBaseId, new Map([...plan.hashes, ...uploaded]))
    },

    async read(stored, ctx) {
      const docs = await loadDocs(ctx, stored.id)
      const { byName, unmanaged } = sourceDocs(docs)
      const hashes = new Map<string, string>()
      const unhashed = await hashDocs(ctx, stored.id, byName.values(), hashes)
      const view = knowledgeView(stored, docs, hashes)
      const printed = knowledgeCodec.print(stored.key, view.decl)
      const left = unmanaged + byName.size - hashes.size - unhashed.length
      const diagnostics: WorkspaceSourceDiagnostic[] = []
      if (unhashed.length > 0) {
        diagnostics.push(
          finding(
            stored.key,
            'I_KB_DOCS_UNHASHED',
            `${unhashed.length} document(s) of "${stored.name}" are listed without a hash: this get reached its download budget.`
          )
        )
      }
      if (left > 0) {
        diagnostics.push(
          finding(
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
