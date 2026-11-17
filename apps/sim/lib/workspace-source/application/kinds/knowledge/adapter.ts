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
import { sha256Hex } from '@sim/security/hash'
import { generateId } from '@sim/utils/id'
import { fingerprintOf, resourceAddress } from '@sim/workspace-code'
import {
  type KnowledgeBaseDecl,
  knowledgeCodec,
  knowledgeDocPath,
} from '@sim/workspace-code/kinds/knowledge'
import { authorizeWorkspaceOperation } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { MAX_FOLDERS_PER_WORKSPACE } from '@/lib/folders/constants'
import { loadActiveFolderPathIndex } from '@/lib/folders/queries'
import { knowledgeDelegationPolicy } from '@/lib/knowledge/application/authorization'
import { resolveKnowledgeWorkspaceContext } from '@/lib/knowledge/application/contexts'
import {
  admitKnowledgeDocumentUpload,
  deleteKnowledgeDocument,
  uploadKnowledgeDocument,
} from '@/lib/knowledge/application/documents'
import {
  createKnowledgeBase,
  deleteKnowledgeBaseOperation,
  listKnowledgeBases,
  readKnowledgeBase,
  updateKnowledgeBaseOperation,
} from '@/lib/knowledge/application/knowledge-bases'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { getConfiguredKbEmbedding } from '@/lib/knowledge/embeddings'
import { getFileExtension } from '@/lib/uploads/utils/file'
import { isSupportedExtension, SUPPORTED_MIME_TYPES } from '@/lib/uploads/utils/validation'
import { ResourceChangedError } from '@/lib/workspace-source/application/errors'
import {
  noBaseFinding,
  planUndeclared,
  serverChangedFinding,
  staleFinding,
} from '@/lib/workspace-source/application/findings'
import {
  checkDeclaration,
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
  knowledgeView,
  loadDocs,
  type StoredKnowledgeBase,
  type StoredKnowledgeState,
  sourceDocs,
} from '@/lib/workspace-source/application/kinds/knowledge/stored'
import { resolveDeclared } from '@/lib/workspace-source/application/three-way'
import type {
  AppliedResource,
  ApplyContext,
  KindAdapter,
  PlanContext,
  PlannedChange,
  SourceContext,
  StoredSet,
} from '@/lib/workspace-source/application/types'
import { claimResourceKey, readKeysByResource, resolveKeys } from '@/lib/workspaces/resource-keys'

/** What the apply carries out for one knowledge base, decided at plan time. */
interface KnowledgePlan {
  changes: Pick<KnowledgeChanges, 'settings' | 'uploads' | 'deletes'>
  /** Document id → SHA-256 for every stored document whose bytes the plan knows. */
  hashes: Map<string, string>
  /** The stored knowledge base's fingerprint under `hashes` when planned; absent for a create. */
  serverFingerprint?: string
}

type KnowledgeChange = PlannedChange<KnowledgeBaseDecl, KnowledgePlan>

const KIND = 'knowledge-base'

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

/** The model new knowledge bases are created with, or `null` when the server cannot say. */
async function configuredModel(): Promise<string | null> {
  try {
    return (await getConfiguredKbEmbedding()).model
  } catch {
    return null
  }
}

async function planKnowledgeBase(
  key: string,
  decl: KnowledgeBaseDecl,
  stored: StoredSet<StoredKnowledgeState>,
  ctx: PlanContext,
  folders: ReadonlySet<string>
): Promise<KnowledgeChange> {
  const change: KnowledgeChange = {
    kind: KIND,
    key,
    action: 'noop',
    decl,
    diagnostics: checkDeclaration(key, decl),
  }
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
  const base = ctx.base?.resources[resourceAddress(KIND, key)]
  const docsOf = new Map<string, Awaited<ReturnType<typeof loadDocs>>>()
  const docs = async (resource: StoredKnowledgeBase) => {
    const loaded = docsOf.get(resource.id) ?? (await loadDocs(ctx, resource.id))
    docsOf.set(resource.id, loaded)
    return loaded
  }
  const bound = stored.bound.get(key)
  const boundDocs = bound ? await docs(bound) : []
  /** Without a base for it, the stored documents are hashed so a matching directory is a no-op. */
  const known = !bound
    ? new Map<string, string>()
    : base?.id === bound.id && base.fingerprint
      ? baseHashes(boundDocs, base)
      : await hashDocs(ctx, bound.id, boundDocs)
  const resolution = resolveDeclared({
    local: fingerprintOf(knowledgeCodec.canonical(decl)),
    stored: bound,
    adoptable: stored.unbound.find(
      (candidate) => candidate.name === decl.name && !candidate.state.knowledgeBase.isSearchIndex
    ),
    base,
    fingerprint: (resource) =>
      knowledgeView(resource, docsOf.get(resource.id) ?? [], known).fingerprint,
  })
  const target = resolution.action === 'create' ? undefined : resolution.stored
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
          ? { base: knowledgeView(resolution.stored, await docs(resolution.stored), known).base }
          : {}),
      }
    }
    case 'create': {
      const holder = [...stored.bound.values(), ...stored.unbound].find(
        (candidate) => candidate.name === decl.name
      )
      if (holder) {
        change.diagnostics.push(
          finding(
            key,
            'E_NAME_TAKEN',
            holder.key
              ? `The knowledge base name "${decl.name}" belongs to the knowledge base under key "${holder.key}".`
              : `A knowledge base this directory cannot manage is already named "${decl.name}".`,
            'Rename one of them, or declare that knowledge base under its own key.'
          )
        )
      }
      const model = decl.embeddingModel === undefined ? null : await configuredModel()
      if (model !== null && decl.embeddingModel !== model) {
        change.diagnostics.push(
          finding(
            key,
            'E_KB_EMBEDDING_MODEL',
            `This server creates knowledge bases with ${model}, not ${decl.embeddingModel}.`,
            `Declare embeddingModel: '${model}', or leave it out.`
          )
        )
      }
      ctx.pending.push({ kind: KIND, key, id: generateId() })
      const uploads = Object.entries(decl.docs).map(([name, doc]) => ({ name, doc }))
      change.diagnostics.push(...indexingFindings(key, uploads, false, 0))
      return {
        ...change,
        action: 'create',
        fields: uploads.map((upload) => `docs/${upload.name} (add)`),
        needsBlobs: uploadPaths(key, uploads),
        partialBlobs: true,
        detail: { changes: { settings: {}, uploads, deletes: [] }, hashes: new Map() },
      }
    }
    case 'adopt':
    case 'update': {
      const resource = resolution.stored
      const storedDocs = await docs(resource)
      const hashes = new Map(known)
      const managed = new Set(
        resolution.action === 'update' ? baseHashes(storedDocs, resolution.base).keys() : []
      )
      const changes = await diffKnowledgeBase({
        key,
        decl,
        stored: resource,
        docs: storedDocs,
        hashes,
        managed,
        ctx,
      })
      change.diagnostics.push(...changes.diagnostics)
      const changed =
        changes.fields.length > 0 || changes.uploads.length > 0 || changes.deletes.length > 0
      return {
        ...change,
        action: resolution.action === 'adopt' ? 'adopt' : changed ? 'update' : 'noop',
        storedId: resource.id,
        ...(changes.fields.length > 0 ? { fields: changes.fields } : {}),
        ...(changes.deletes.length > 0
          ? { destructive: { what: 'documents', counts: { documents: changes.deletes.length } } }
          : {}),
        ...(changes.uploads.length > 0
          ? { needsBlobs: uploadPaths(key, changes.uploads), partialBlobs: true }
          : {}),
        detail: {
          changes,
          hashes,
          serverFingerprint: knowledgeView(resource, storedDocs, hashes).fingerprint,
        },
      }
    }
  }
}

/**
 * Uploads each document whose bytes this round carries, checking them against the declared hash,
 * and deletes the document it replaces only once its replacement is stored. Returns the new
 * documents' hashes by id and whether every upload ran.
 */
async function uploadDocs(
  ctx: ApplyContext,
  key: string,
  knowledgeBaseId: string,
  uploads: readonly DocUpload[]
): Promise<{ hashes: Map<string, string>; complete: boolean }> {
  const workspaceId = ctx.workspace.workspaceId
  const hashes = new Map<string, string>()
  let complete = true
  for (const upload of uploads) {
    const path = knowledgeDocPath(key, upload.name)
    const content = ctx.blobs?.content.get(path)
    if (content === undefined) {
      complete = false
      continue
    }
    const buffer = Buffer.from(content, 'base64')
    if (buffer.byteLength !== upload.doc.size || sha256Hex(buffer) !== upload.doc.sha256) {
      throw new OrchestrationError('validation', `${path} does not match its declared hash.`)
    }
    const extension = getFileExtension(upload.name)
    const { document } = await uploadKnowledgeDocument.execute({
      principal: ctx.principal,
      input: {
        knowledgeBaseId,
        assertedWorkspaceId: workspaceId,
        file: {
          buffer,
          filename: upload.name,
          fileSize: buffer.byteLength,
          mimeType: isSupportedExtension(extension) ? SUPPORTED_MIME_TYPES[extension][0] : '',
        },
      },
    })
    hashes.set(document.id, upload.doc.sha256)
    if (upload.replaces) {
      await deleteKnowledgeDocument.execute({
        principal: ctx.principal,
        input: {
          knowledgeBaseId,
          documentId: upload.replaces.id,
          assertedWorkspaceId: workspaceId,
        },
      })
    }
  }
  return { hashes, complete }
}

/** The stored knowledge base, its base entry and reprinted declaration after a write. */
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
      const index = await loadActiveFolderPathIndex(
        ctx.workspace.workspaceId,
        'knowledge_base',
        undefined,
        { maxRows: MAX_FOLDERS_PER_WORKSPACE }
      )
      const folders = new Set(index.pathById.values())
      const changes: KnowledgeChange[] = []
      for (const [key, decl] of desired) {
        changes.push(await planKnowledgeBase(key, decl, stored, ctx, folders))
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
          })
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
          await authorizeWorkspaceOperation(
            principal,
            knowledgeOperations.uploadDocument,
            await resolveKnowledgeWorkspaceContext({ workspaceId }),
            { delegation: knowledgeDelegationPolicy }
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
        changes.deletes[0] ?? changes.uploads.find((upload) => upload.replaces)?.replaces
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
        await claimResourceKey({
          workspaceId,
          kind: KIND,
          key: change.key,
          resourceId: knowledgeBase.id,
          origin: 'created',
          createdBy: ctx.createdBy,
        })
        const uploaded = await uploadDocs(ctx, change.key, knowledgeBase.id, plan.changes.uploads)
        return written(ctx, change.key, knowledgeBase.id, uploaded.hashes)
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
      const { settings, uploads, deletes } = plan.changes
      if (Object.keys(settings).length > 0) {
        await updateKnowledgeBaseOperation.execute({
          principal,
          input: { knowledgeBaseId, assertedWorkspaceId: workspaceId, ...settings },
        })
      }
      const uploaded = await uploadDocs(ctx, change.key, knowledgeBaseId, uploads)
      /** Deletes wait for the round that carries every blob, so a resumed apply loses nothing. */
      if (uploaded.complete && ctx.blobs?.complete !== false) {
        for (const doc of deletes) {
          await deleteKnowledgeDocument.execute({
            principal,
            input: { knowledgeBaseId, documentId: doc.id, assertedWorkspaceId: workspaceId },
          })
        }
      }
      return written(
        ctx,
        change.key,
        knowledgeBaseId,
        new Map([...plan.hashes, ...uploaded.hashes])
      )
    },

    async read(stored, ctx) {
      const docs = await loadDocs(ctx, stored.id)
      const { byName, unmanaged } = sourceDocs(docs)
      const hashes = await hashDocs(ctx, stored.id, docs)
      const view = knowledgeView(stored, docs, hashes)
      const printed = knowledgeCodec.print(stored.key, view.decl)
      const left = unmanaged + byName.size - hashes.size
      return {
        text: printed.text,
        blobs: printed.blobs.flatMap((blob) => {
          const doc = byName.get(blob.path.slice(knowledgeDocPath(stored.key, '').length))
          return doc ? [{ ...blob, id: doc.id, href: doc.fileUrl }] : []
        }),
        base: view.base,
        ...(left > 0
          ? {
              diagnostics: [
                finding(
                  stored.key,
                  'I_KB_UNMANAGED_DOCS',
                  `${left} document(s) of "${stored.name}" are not part of source (connector-synced, too large, unreadable, or sharing a file name) and are left as they are.`
                ),
              ],
            }
          : {}),
      }
    },
  }
