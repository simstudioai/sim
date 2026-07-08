import type {
  ForkCopyableKind,
  ForkCopyableUnmapped,
  PromoteCopyResources,
} from '@/lib/api/contracts/workspace-fork'
import type { DbOrTx } from '@/lib/db/types'
import {
  type SerializableForkContentRefMaps,
  serializeContentRefMaps,
} from '@/lib/workspaces/fork/copy/content-copy-runner'
import { type BlobCopyTask, planForkFileCopies } from '@/lib/workspaces/fork/copy/copy-files'
import type { ForkContentPlan } from '@/lib/workspaces/fork/copy/copy-resources'
import {
  copyForkResourceContainers,
  planForkMappedKbDocumentCopies,
} from '@/lib/workspaces/fork/copy/copy-resources'
import type { ForkEdge } from '@/lib/workspaces/fork/lineage/lineage'
import {
  deleteEdgeMappingsByChildResources,
  type ForkMappingUpsert,
  resourceTypeToForkKind,
  upsertEdgeMappings,
} from '@/lib/workspaces/fork/mapping/mapping-store'
import type { ForkBlockIdResolver } from '@/lib/workspaces/fork/remap/block-identity'
import type {
  ForkReferenceResolver,
  ForkRemapKind,
} from '@/lib/workspaces/fork/remap/remap-references'

/**
 * The source ids selected for copy at promote, validated against the plan's copyable
 * candidates. Exactly the sync-copyable kinds (`forkCopyableKindSchema`): workflow-publishing
 * MCP servers are fork-create-only (never a promote copy candidate), so they have no slot here.
 */
export interface PromoteCopySelection {
  customTools: string[]
  skills: string[]
  tables: string[]
  knowledgeBases: string[]
  /** Workspace files to copy, identified by storage key (not `workspace_files.id`). */
  files: string[]
}

/**
 * Each copyable kind to its key in {@link PromoteCopySelection}. Keyed on `ForkCopyableKind`
 * (the wire contract enum) so TS fails to compile if the copyable enum grows a kind without a
 * selection key here, keeping the two in lockstep.
 */
export const FORK_COPYABLE_KIND_TO_SELECTION_KEY: Record<
  ForkCopyableKind,
  keyof PromoteCopySelection
> = {
  'knowledge-base': 'knowledgeBases',
  table: 'tables',
  'custom-tool': 'customTools',
  skill: 'skills',
  file: 'files',
}

/**
 * Intersect the user's requested copy with the plan's actual copyable candidates (referenced or
 * not, always unmapped + still existing in the source), so a crafted request can never copy an
 * arbitrary resource. Returns the validated selection plus the set of `${kind}:${sourceId}`
 * references the copy will resolve, for the pre-copy sync gate - an unreferenced candidate's key
 * simply matches no reference there, which is harmless.
 */
export function buildPromoteCopySelection(
  requested: PromoteCopyResources | undefined,
  copyableUnmapped: ForkCopyableUnmapped[]
): { selection: PromoteCopySelection; willResolve: Set<string> } {
  const allowed = new Map<string, Set<string>>()
  for (const candidate of copyableUnmapped) {
    const set = allowed.get(candidate.kind)
    if (set) set.add(candidate.sourceId)
    else allowed.set(candidate.kind, new Set([candidate.sourceId]))
  }
  const selection: PromoteCopySelection = {
    customTools: [],
    skills: [],
    tables: [],
    knowledgeBases: [],
    files: [],
  }
  const willResolve = new Set<string>()
  const apply = (
    kind: keyof typeof FORK_COPYABLE_KIND_TO_SELECTION_KEY,
    ids: string[] | undefined
  ) => {
    const allowedIds = allowed.get(kind)
    if (!allowedIds || !ids) return
    const key = FORK_COPYABLE_KIND_TO_SELECTION_KEY[kind]
    for (const id of ids) {
      if (!allowedIds.has(id)) continue
      selection[key].push(id)
      willResolve.add(`${kind}:${id}`)
    }
  }
  apply('knowledge-base', requested?.knowledgeBases)
  apply('table', requested?.tables)
  apply('custom-tool', requested?.customTools)
  apply('skill', requested?.skills)
  apply('file', requested?.files)
  return { selection, willResolve }
}

/** Whether any resource is selected for copy. */
export function hasPromoteCopySelection(selection: PromoteCopySelection): boolean {
  return (
    selection.customTools.length > 0 ||
    selection.skills.length > 0 ||
    selection.tables.length > 0 ||
    selection.knowledgeBases.length > 0 ||
    selection.files.length > 0
  )
}

/**
 * Layer the just-copied resources' source->target ids on top of the plan's resolver, so the
 * synced workflows' references to those resources resolve to the new copies. The base resolver
 * (persisted mappings + env identity) is consulted for everything else.
 */
export function augmentForkResolver(
  base: ForkReferenceResolver,
  extra: Map<ForkRemapKind, Map<string, string>>
): ForkReferenceResolver {
  return (kind, sourceId) => extra.get(kind)?.get(sourceId) ?? base(kind, sourceId)
}

export interface PromoteCopyResult {
  contentPlan: ForkContentPlan
  /** Copied source resource id -> new target id, by remap kind, for resolver augmentation. */
  copyIdMapByKind: Map<ForkRemapKind, Map<string, string>>
  /**
   * Serialized in-content reference maps for the post-commit copy to rewrite copied skill bodies
   * (their `sim:` links + embedded URLs) off the locked promote tx - carried through the durable
   * content-copy payload, mirroring fork.
   */
  contentRefMaps: SerializableForkContentRefMaps
  /**
   * File blob duplications for copied workspace files, run post-commit by the durable content-copy
   * runner (no object-storage I/O inside the locked promote tx). Empty when no files were copied.
   */
  blobTasks: BlobCopyTask[]
}

/**
 * Copy the selected unmapped resources (referenced or not) a sync brings into the target (reusing
 * the fork copy pipeline), then persist the source<->target id map in the direction the edge expects: a pull
 * fills the existing `(parent, child=null)` row (fill-null), a push replaces any prior
 * `(parent, child)` row keyed on the source child resource (delete-then-insert). This covers:
 *  - the user-selected copyable containers (KB / table / custom-tool / skill) and workspace files,
 *  - documents referenced under a copied knowledge base (auto-placed under that copied KB),
 *  - documents referenced under an ALREADY-mapped (existing) KB - copied into that existing KB so
 *    the `document-selector` reference remaps instead of being cleared.
 *
 * The heavy content (table rows, KB documents + embeddings, file blobs) is returned as a content
 * plan + blob tasks for a post-commit, best-effort fill; no object-storage I/O runs inside the
 * locked promote tx. Always safe to call (a no-op when nothing is selected and nothing references
 * a mapped-KB document).
 */
export async function copyPromoteUnmappedResources(params: {
  tx: DbOrTx
  edge: ForkEdge
  sourceWorkspaceId: string
  targetWorkspaceId: string
  direction: 'push' | 'pull'
  userId: string
  now: Date
  selection: PromoteCopySelection
  workflowIdMap: Map<string, string>
  /** source folder id -> target folder id, so copied skill/markdown bodies rewrite `sim:folder/<id>`. */
  folderIdMap: Map<string, string>
  /** Base resolver (persisted mappings + env identity), used to detect already-mapped KBs (U-docs). */
  resolver: ForkReferenceResolver
  /**
   * The SAME block-id resolver the sync's workflow writes use (persisted pairs preferred over
   * derive), so copied tables' workflow-group `outputs[].blockId` point at the blocks the sync
   * actually writes - on push the parent keeps its ORIGINAL block ids, never the derive.
   */
  resolveBlockId: ForkBlockIdResolver
  /**
   * Knowledge-document ids the synced workflows reference, already scanned once in the promote
   * plan and threaded in so the copy doesn't re-scan every source state inside the locked tx.
   * `copyForkResourceContainers` / `planForkMappedKbDocumentCopies` place only those whose parent
   * KB is in this copy (or already mapped), so an extra id is FK-safe and simply skipped.
   */
  referencedDocumentIds: string[]
}): Promise<PromoteCopyResult> {
  const {
    tx,
    edge,
    sourceWorkspaceId,
    targetWorkspaceId,
    direction,
    userId,
    now,
    selection,
    workflowIdMap,
    folderIdMap,
    resolver,
    resolveBlockId,
    referencedDocumentIds,
  } = params

  const result = await copyForkResourceContainers({
    tx,
    sourceWorkspaceId,
    childWorkspaceId: targetWorkspaceId,
    userId,
    now,
    selection: {
      customTools: selection.customTools,
      skills: selection.skills,
      // Workflow-publishing MCP servers are fork-create-only (never a sync-copy candidate);
      // the shared copy pipeline still takes the slot, so pass it empty.
      workflowMcpServers: [],
      tables: selection.tables,
      knowledgeBases: selection.knowledgeBases,
    },
    workflowIdMap,
    referencedDocumentIds,
    // A sync can rename env vars, so a copied custom tool's `code` must have its `{{ENV}}` refs
    // rewritten through the same plan resolver that remaps subblock-value env refs.
    resolveEnvName: (key) => resolver('env-var', key),
    resolveBlockId,
  })

  // Copy the selected workspace files (keyed by storage key) - metadata inserts in the tx, blob
  // duplications deferred to the post-commit runner.
  const fileResult =
    selection.files.length > 0
      ? await planForkFileCopies({
          tx,
          sourceWorkspaceId,
          childWorkspaceId: targetWorkspaceId,
          userId,
          fileKeys: selection.files,
          now,
        })
      : {
          keyMap: new Map<string, string>(),
          idMap: new Map<string, string>(),
          blobTasks: [] as BlobCopyTask[],
        }

  // U-docs: documents referenced under an already-mapped (not copied this sync) KB. Skip any doc
  // already placed under a copied KB above (its parent KB is in this copy), so a doc is never
  // copied twice.
  const containerDocMap = result.idMap.get('knowledge_document') ?? new Map<string, string>()
  const mappedKbDocs = await planForkMappedKbDocumentCopies({
    tx,
    resolver,
    referencedDocumentIds,
    alreadyCopiedSourceDocIds: new Set(containerDocMap.keys()),
  })
  result.contentPlan.documents.push(...mappedKbDocs.documents)

  // Persist every copied resource's mapping (containers + files + U-docs) so a re-sync resolves
  // the copy instead of re-copying it. Files map by storage key; U-docs add knowledge_document rows.
  const fileMappingEntries: ForkMappingUpsert[] = Array.from(
    fileResult.keyMap,
    ([source, child]) => ({
      resourceType: 'file' as const,
      parentResourceId: source,
      childResourceId: child,
    })
  )
  await persistPromoteCopiedMappings(tx, edge.childWorkspaceId, userId, direction, [
    ...result.mappingEntries,
    ...fileMappingEntries,
    ...mappedKbDocs.mappingEntries,
  ])

  const copyIdMapByKind = new Map<ForkRemapKind, Map<string, string>>()
  for (const [resourceType, sourceToTarget] of result.idMap) {
    const kind = resourceTypeToForkKind(resourceType)
    if (!kind) continue
    copyIdMapByKind.set(kind, sourceToTarget)
  }
  if (fileResult.keyMap.size > 0) copyIdMapByKind.set('file', fileResult.keyMap)

  // Merge the container's copied-KB document map with the U-docs map so every copied document
  // (under a copied KB or into an existing one) remaps its `document-selector` reference.
  const documentIdMap = new Map<string, string>([...containerDocMap, ...mappedKbDocs.docIdMap])
  if (documentIdMap.size > 0) copyIdMapByKind.set('knowledge-document', documentIdMap)

  // Serialized maps for the post-commit content rewrite (run off the locked promote tx). Mirrors
  // fork: workspace + workflow + folder ids plus this copy's own file/skill/table/KB maps, so a
  // copied skill body / markdown blob's `sim:` links + embedded file URLs resolve to the new target
  // copies instead of the source.
  const contentRefMaps = serializeContentRefMaps({
    workspaceId: { from: sourceWorkspaceId, to: targetWorkspaceId },
    workflows: workflowIdMap,
    folders: folderIdMap,
    fileKeys: fileResult.keyMap,
    fileIds: fileResult.idMap,
    skills: result.idMap.get('skill'),
    tables: result.idMap.get('table'),
    knowledgeBases: result.idMap.get('knowledge_base'),
  })

  return {
    contentPlan: result.contentPlan,
    copyIdMapByKind,
    contentRefMaps,
    blobTasks: fileResult.blobTasks,
  }
}

/**
 * Persist the copied resources' id mappings for the edge. The copy returns entries oriented
 * source(parent)->target(child); a pull matches that orientation directly (fill-null upsert), a
 * push swaps it (the parent side is the new TARGET) and first drops any prior row keyed on the
 * source child resource so a changed target can't leak a second mapping.
 */
export async function persistPromoteCopiedMappings(
  tx: DbOrTx,
  childWorkspaceId: string,
  userId: string,
  direction: 'push' | 'pull',
  entries: ForkMappingUpsert[]
): Promise<void> {
  if (entries.length === 0) return
  if (direction === 'pull') {
    await upsertEdgeMappings(tx, childWorkspaceId, userId, entries)
    return
  }
  // Push: re-key on the source child resource. Skip any entry with a null child id (copy entries
  // always carry one; the guard narrows the type so neither the swap nor the delete needs a cast).
  // After the swap every childResourceId is the original (non-null) parent id, keyed for the
  // delete-then-insert that prevents a changed target from leaking a second mapping.
  const swapped: ForkMappingUpsert[] = []
  const deleteKeys: Array<{
    resourceType: ForkMappingUpsert['resourceType']
    childResourceId: string
  }> = []
  for (const entry of entries) {
    if (entry.childResourceId == null) continue
    swapped.push({
      resourceType: entry.resourceType,
      parentResourceId: entry.childResourceId,
      childResourceId: entry.parentResourceId,
    })
    deleteKeys.push({ resourceType: entry.resourceType, childResourceId: entry.parentResourceId })
  }
  if (swapped.length === 0) return
  await deleteEdgeMappingsByChildResources(tx, childWorkspaceId, deleteKeys)
  await upsertEdgeMappings(tx, childWorkspaceId, userId, swapped)
}
