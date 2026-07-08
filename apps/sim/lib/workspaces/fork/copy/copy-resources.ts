import { db } from '@sim/db'
import {
  customTools,
  document,
  embedding,
  knowledgeBase,
  knowledgeBaseTagDefinitions,
  skill,
  userTableDefinitions,
  userTableRows,
  workflowMcpServer,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, asc, eq, gt, inArray, isNull, type SQL, sql } from 'drizzle-orm'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import type { DbOrTx } from '@/lib/db/types'
import type { TableSchema } from '@/lib/table/types'
import { generateKnowledgeBaseFileKey } from '@/lib/uploads/contexts/knowledge-base/knowledge-base-file-manager'
import { downloadFile, uploadFile } from '@/lib/uploads/core/storage-service'
import { MAX_FILE_SIZE } from '@/lib/uploads/utils/validation'
import { isRecord } from '@/lib/workflows/persistence/remap-internal-ids'
import type {
  ForkMappingUpsert,
  ForkResourceType,
} from '@/lib/workspaces/fork/mapping/mapping-store'
import type { ForkBlockIdResolver } from '@/lib/workspaces/fork/remap/block-identity'
import {
  type ForkContentRefMaps,
  rewriteForkContentRefs,
  rewriteForkResourceUrls,
} from '@/lib/workspaces/fork/remap/remap-content-refs'
import {
  type ForkReferenceResolver,
  rewriteEnvRefsInText,
} from '@/lib/workspaces/fork/remap/remap-references'
import { remapForkTableWorkflowGroups } from '@/lib/workspaces/fork/remap/remap-table-groups'

const logger = createLogger('WorkspaceForkCopyResources')

/** Page size for the post-transaction bulk content copy (keyset-paginated). */
const CONTENT_PAGE = 500

/**
 * Max documents copied concurrently within one KB page. Bounds fan-out (blob copy + per-doc
 * embedding paging) so a large page doesn't issue every request at once; the keyset loop still
 * processes one page at a time, so peak concurrency stays at this cap regardless of KB size.
 */
const KB_DOCUMENT_COPY_CONCURRENCY = 5

/**
 * Max copied skill bodies rewritten concurrently within one keyset page. Bounds the per-skill
 * re-read + UPDATE fan-out so a page of copied skills doesn't issue every write at once; the keyset
 * loop still processes one page at a time, so peak concurrency stays at this cap.
 */
const SKILL_REWRITE_CONCURRENCY = 5

export interface CopyResourcesParams {
  tx: DbOrTx
  sourceWorkspaceId: string
  childWorkspaceId: string
  userId: string
  now: Date
  /** Source resource ids selected for copy, by kind. */
  selection: {
    customTools: string[]
    skills: string[]
    workflowMcpServers: string[]
    tables: string[]
    knowledgeBases: string[]
  }
  /** source workflow id -> child workflow id, for table workflow-group remap. */
  workflowIdMap: Map<string, string>
  /**
   * Source KB-document ids referenced by the copied workflows (document-selector values +
   * nested `documentId` tool params). Documents in this set whose parent KB is being copied
   * get a placeholder row + a persisted `knowledge_document` id map inside the transaction, so
   * the reference remaps to the copied document instead of being cleared. Defaults to none.
   */
  referencedDocumentIds?: string[]
  /**
   * Resolve a source env-var name to its target name, so a copied custom tool's `code` (which
   * embeds `{{ENV}}` refs) is rewritten when a sync renames an env var. Provided by promote (the
   * plan resolver); omitted by fork-create, which preserves env names verbatim (no rewrite).
   */
  resolveEnvName?: (key: string) => string | null | undefined
  /**
   * Resolve a source block id to its target block id for copied tables' workflow-group
   * `outputs[].blockId`. Promote passes the SAME persisted-pair resolver its workflow writes
   * use (on push the parent keeps its ORIGINAL block ids, never the derive); fork-create
   * omits it, defaulting to the deterministic derive (a fresh child has no pairs).
   */
  resolveBlockId?: ForkBlockIdResolver
}

export interface ForkContentPlanEntry {
  sourceId: string
  childId: string
}

/**
 * A KB to copy post-commit, plus the source-document -> child-document id map for the
 * documents that were pre-created as placeholders in the transaction (referenced by copied
 * workflows). The content phase fills those exact child ids (and copies the rest fresh) so a
 * remapped `document-selector` reference can never dangle.
 */
export interface ForkContentKbEntry extends ForkContentPlanEntry {
  documentIdMap: Record<string, string>
}

/**
 * A copied skill whose body's in-content references (`sim:` links + embedded file URLs) are
 * rewritten post-commit. Only the child id is carried: the child row is inserted in the fork tx
 * with the SOURCE body copied IN-DB (never materialized in app memory or embedded in the job
 * payload), and the content phase RE-READS the body keyset-paginated to rewrite it best-effort so
 * it points at the copied child resources (an unmapped target degrades to a graceful broken link,
 * never an FK/subblock reference).
 */
export interface ForkContentSkillEntry {
  childId: string
}

/**
 * A single source document copied into an EXISTING (already-mapped, not copied this sync) target
 * KB - the sync-only "document into mapped KB" path (U-docs). The placeholder row is inserted in
 * the promote tx at `childDocId` under `childKnowledgeBaseId`; the content phase fills its
 * embeddings (and re-keys its blob) best-effort. Distinct from {@link ForkContentKbEntry}, which
 * copies a whole KB's documents - here only the referenced documents are placed, since the KB
 * itself already exists in the target with its own documents.
 */
export interface ForkContentDocumentEntry {
  sourceDocId: string
  childDocId: string
  childKnowledgeBaseId: string
  /** Source blob fields captured at placeholder time, for the post-commit blob re-key. */
  storageKey: string | null
  filename: string
  mimeType: string
}

/** Bulk content to copy AFTER the fork transaction commits (best-effort, batched). */
export interface ForkContentPlan {
  sourceWorkspaceId: string
  childWorkspaceId: string
  /** Initiating user, recorded as the owner of copied KB-document blob bindings in the child. */
  userId: string
  tables: ForkContentPlanEntry[]
  knowledgeBases: ForkContentKbEntry[]
  skills: ForkContentSkillEntry[]
  /** Documents copied into an already-existing target KB (sync-only; empty at fork create). */
  documents: ForkContentDocumentEntry[]
}

/**
 * A resource whose post-commit content fill failed, so every reference to it must be cleared.
 * A table carries its child definition id; a KB carries its child id (dropping it cascade-removes
 * its documents + embeddings) and the child ids of the document placeholders pre-created in the
 * fork tx, so `document-selector` references clear too. A standalone `knowledge-document` (a doc
 * copied into an existing target KB) carries just its child id - dropping that one row (its
 * embeddings cascade) without touching the existing KB. A `file` carries the COPIED child storage
 * key whose blob duplication failed: its `file-upload` references are cleared so no block points at
 * a missing object. Unlike the others, a failed file drops no row - the metadata row is left so the
 * user can re-upload the blob.
 */
export type ForkFailedResource =
  | { kind: 'table'; childId: string }
  | { kind: 'knowledge-base'; childId: string; documentChildIds: string[] }
  | { kind: 'knowledge-document'; childId: string }
  | { kind: 'file'; childKey: string }

/** Display names of the copied resources, by kind, for the fork activity report. */
export interface ForkCopiedResourceNames {
  tables: string[]
  knowledgeBases: string[]
  customTools: string[]
  skills: string[]
  workflowMcpServers: string[]
}

export interface CopyResourcesResult {
  /** source resource id -> child resource id, keyed by fork resource type. */
  idMap: Map<ForkResourceType, Map<string, string>>
  /** Identity mapping rows to persist for every copied resource. */
  mappingEntries: ForkMappingUpsert[]
  /** Heavy row/document/embedding content to copy post-commit. */
  contentPlan: ForkContentPlan
  /** Names of the copied resources, by kind, for the fork report breakdown. */
  names: ForkCopiedResourceNames
}

function setId(idMap: Map<ForkResourceType, Map<string, string>>, type: ForkResourceType) {
  let map = idMap.get(type)
  if (!map) {
    map = new Map()
    idMap.set(type, map)
  }
  return map
}

/**
 * Child `skill` insert whose `content` is a correlated subquery (copied server-side from the source
 * row) rather than a materialized string, so the fork tx never pulls skill bodies into app memory -
 * see the skeleton skill copy in {@link copyForkResourceContainers}.
 */
type SkillSkeletonInsert = Omit<typeof skill.$inferInsert, 'content'> & { content: SQL }

/**
 * Copy the selected resources' **container rows** into the child workspace inside
 * the fork transaction: custom tools, skills, and MCP server configs (each a
 * single row), plus table definitions and knowledge-base rows with their tag
 * definitions (bounded per KB) but without their bulk rows / documents /
 * embeddings. This keeps the fork transaction bounded to
 * O(selected resources) single-row writes. The heavy content (table rows, KB
 * documents + embeddings) is returned as a {@link ForkContentPlan} for
 * {@link copyForkResourceContent} to copy best-effort after commit. Secrets are
 * never copied: MCP OAuth tokens are omitted (re-auth required) and KB connectors
 * are not copied (the child is a content snapshot without live sync).
 */
export async function copyForkResourceContainers(
  params: CopyResourcesParams
): Promise<CopyResourcesResult> {
  const { tx, sourceWorkspaceId, childWorkspaceId, userId, now, selection, workflowIdMap } = params
  const referencedDocumentIds = params.referencedDocumentIds ?? []
  const resolveEnvName = params.resolveEnvName
  const idMap = new Map<ForkResourceType, Map<string, string>>()
  const mappingEntries: ForkMappingUpsert[] = []
  const contentPlan: ForkContentPlan = {
    sourceWorkspaceId,
    childWorkspaceId,
    userId,
    tables: [],
    knowledgeBases: [],
    skills: [],
    documents: [],
  }
  const names: ForkCopiedResourceNames = {
    tables: [],
    knowledgeBases: [],
    customTools: [],
    skills: [],
    workflowMcpServers: [],
  }

  const record = (type: ForkResourceType, sourceId: string, childId: string) => {
    setId(idMap, type).set(sourceId, childId)
    mappingEntries.push({
      resourceType: type,
      parentResourceId: sourceId,
      childResourceId: childId,
    })
  }

  if (selection.customTools.length > 0) {
    const rows = await tx
      .select()
      .from(customTools)
      .where(
        and(
          inArray(customTools.id, selection.customTools),
          eq(customTools.workspaceId, sourceWorkspaceId)
        )
      )
    const inserts: (typeof customTools.$inferInsert)[] = []
    for (const row of rows) {
      const childId = generateId()
      inserts.push({
        ...row,
        id: childId,
        workspaceId: childWorkspaceId,
        userId,
        // The code column is copied verbatim, so a `{{ENV}}` ref in it would stay stale when a
        // sync renames the env var. Rewrite those refs through the env-name resolver (subblock
        // values are already remapped by the reference transform). Fork-create passes no resolver,
        // preserving env names by default.
        ...(resolveEnvName && typeof row.code === 'string'
          ? { code: rewriteEnvRefsInText(row.code, resolveEnvName) }
          : {}),
        createdAt: now,
        updatedAt: now,
      })
      record('custom_tool', row.id, childId)
      names.customTools.push(row.title)
    }
    if (inserts.length > 0) await tx.insert(customTools).values(inserts)
  }

  if (selection.skills.length > 0) {
    // Select every skill column EXCEPT `content`: the body (capped at 50 KB each, up to 2000 skills)
    // is copied server-side via the correlated subquery below, so it is never materialized in app
    // memory while the fork tx holds its locks - nor carried in the background-job payload.
    const rows = await tx
      .select({
        id: skill.id,
        workspaceId: skill.workspaceId,
        userId: skill.userId,
        name: skill.name,
        description: skill.description,
        createdAt: skill.createdAt,
        updatedAt: skill.updatedAt,
      })
      .from(skill)
      .where(and(inArray(skill.id, selection.skills), eq(skill.workspaceId, sourceWorkspaceId)))
    const inserts: SkillSkeletonInsert[] = []
    for (const row of rows) {
      const childId = generateId()
      inserts.push({
        ...row,
        id: childId,
        workspaceId: childWorkspaceId,
        userId,
        // Copy the body straight from the source row in-DB (never through app memory). Re-read and
        // rewritten post-commit (see copyForkResourceContent), out of the locked fork tx.
        content: sql`(SELECT ${skill.content} FROM ${skill} WHERE ${skill.id} = ${row.id})`,
        createdAt: now,
        updatedAt: now,
      })
      record('skill', row.id, childId)
      contentPlan.skills.push({ childId })
      names.skills.push(row.name)
    }
    if (inserts.length > 0) await tx.insert(skill).values(inserts)
  }

  if (selection.workflowMcpServers.length > 0) {
    const rows = await tx
      .select()
      .from(workflowMcpServer)
      .where(
        and(
          inArray(workflowMcpServer.id, selection.workflowMcpServers),
          eq(workflowMcpServer.workspaceId, sourceWorkspaceId),
          isNull(workflowMcpServer.deletedAt)
        )
      )
    // Copy workflow-publishing MCP servers as config-only shells: the server definition
    // (name/description/visibility) with NO `workflow_mcp_tool` rows attached, so the child
    // re-registers its own workflows. These are fork-copy-only (not referenced by subblocks),
    // so they are not recorded in the fork resource map.
    const inserts: (typeof workflowMcpServer.$inferInsert)[] = []
    for (const row of rows) {
      inserts.push({
        ...row,
        id: generateId(),
        workspaceId: childWorkspaceId,
        createdBy: userId,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      names.workflowMcpServers.push(row.name)
    }
    if (inserts.length > 0) await tx.insert(workflowMcpServer).values(inserts)
  }

  if (selection.tables.length > 0) {
    const definitions = await tx
      .select()
      .from(userTableDefinitions)
      .where(
        and(
          inArray(userTableDefinitions.id, selection.tables),
          eq(userTableDefinitions.workspaceId, sourceWorkspaceId),
          isNull(userTableDefinitions.archivedAt)
        )
      )
    const inserts: (typeof userTableDefinitions.$inferInsert)[] = []
    for (const definition of definitions) {
      const childTableId = generateId()
      const remappedSchema = remapForkTableWorkflowGroups(
        definition.schema as TableSchema,
        workflowIdMap,
        params.resolveBlockId
      )
      inserts.push({
        ...definition,
        id: childTableId,
        workspaceId: childWorkspaceId,
        schema: remappedSchema,
        createdBy: userId,
        rowsVersion: 0,
        // Start at 0 - the post-commit content copy raises it to the rows actually
        // copied, so a failed/partial copy never advertises the source's count.
        rowCount: 0,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      record('table', definition.id, childTableId)
      contentPlan.tables.push({ sourceId: definition.id, childId: childTableId })
      names.tables.push(definition.name)
    }
    if (inserts.length > 0) await tx.insert(userTableDefinitions).values(inserts)
  }

  if (selection.knowledgeBases.length > 0) {
    const bases = await tx
      .select()
      .from(knowledgeBase)
      .where(
        and(
          inArray(knowledgeBase.id, selection.knowledgeBases),
          eq(knowledgeBase.workspaceId, sourceWorkspaceId),
          isNull(knowledgeBase.deletedAt)
        )
      )
    const inserts: (typeof knowledgeBase.$inferInsert)[] = []
    const kbEntryBySourceId = new Map<string, ForkContentKbEntry>()
    for (const base of bases) {
      const childKbId = generateId()
      inserts.push({
        ...base,
        id: childKbId,
        workspaceId: childWorkspaceId,
        userId,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      record('knowledge_base', base.id, childKbId)
      const entry: ForkContentKbEntry = { sourceId: base.id, childId: childKbId, documentIdMap: {} }
      contentPlan.knowledgeBases.push(entry)
      kbEntryBySourceId.set(base.id, entry)
      names.knowledgeBases.push(base.name)
    }
    if (inserts.length > 0) await tx.insert(knowledgeBase).values(inserts)

    // Copy each source KB's tag definitions to its child so tagged documents keep a working tag
    // schema: the copied documents carry tag VALUES in their slot columns, and both tag-filter
    // search and documentTags writes resolve display names through these definition rows (a copy
    // without them 400s / throws on every defined tag). Fresh ids, child KB id, all other columns
    // verbatim - nothing persists a tag-definition id (workflow state, documents, and fork
    // mappings all reference tags by display name / slot), so no id map is recorded.
    if (kbEntryBySourceId.size > 0) {
      const tagDefinitions = await tx
        .select()
        .from(knowledgeBaseTagDefinitions)
        .where(
          inArray(knowledgeBaseTagDefinitions.knowledgeBaseId, Array.from(kbEntryBySourceId.keys()))
        )
      const tagDefinitionInserts: (typeof knowledgeBaseTagDefinitions.$inferInsert)[] = []
      for (const definition of tagDefinitions) {
        const childKbId = kbEntryBySourceId.get(definition.knowledgeBaseId)?.childId
        if (!childKbId) continue
        tagDefinitionInserts.push({
          ...definition,
          id: generateId(),
          knowledgeBaseId: childKbId,
        })
      }
      if (tagDefinitionInserts.length > 0) {
        await tx.insert(knowledgeBaseTagDefinitions).values(tagDefinitionInserts)
      }
    }

    // Pre-create placeholder document rows for the documents the copied workflows
    // reference, at child ids generated inside the transaction, so each
    // `document-selector` reference can be remapped to a valid copied document rather
    // than cleared. Only documents whose parent KB is in this copy (FK-safe: the KB
    // rows were just inserted above) are placed; the heavy content (embeddings + blob)
    // is filled at these exact ids by the post-commit content phase.
    await createForkDocumentPlaceholders({
      tx,
      kbIdMap: idMap.get('knowledge_base') ?? new Map(),
      kbEntryBySourceId,
      referencedDocumentIds,
      record,
    })
  }

  return { idMap, mappingEntries, contentPlan, names }
}

/**
 * Insert placeholder {@link document} rows in the child KBs for the referenced documents
 * whose parent KB is being copied, recording the `knowledge_document` source->child id map.
 * Each placeholder is the source document's metadata row at a fresh child id; its embeddings
 * and (re-keyed) blob are filled by {@link copyForkResourceContent} after commit. Documents
 * whose parent KB is not copied are skipped, leaving their references to be cleared.
 */
async function createForkDocumentPlaceholders(params: {
  tx: DbOrTx
  kbIdMap: Map<string, string>
  kbEntryBySourceId: Map<string, ForkContentKbEntry>
  referencedDocumentIds: string[]
  record: (type: ForkResourceType, sourceId: string, childId: string) => void
}): Promise<void> {
  const { tx, kbIdMap, kbEntryBySourceId, referencedDocumentIds, record } = params
  if (referencedDocumentIds.length === 0 || kbIdMap.size === 0) return

  const docs = await tx
    .select()
    .from(document)
    .where(
      and(
        inArray(document.id, referencedDocumentIds),
        inArray(document.knowledgeBaseId, Array.from(kbIdMap.keys())),
        isNull(document.deletedAt),
        isNull(document.archivedAt)
      )
    )

  const inserts: (typeof document.$inferInsert)[] = []
  for (const doc of docs) {
    const childKbId = kbIdMap.get(doc.knowledgeBaseId)
    const kbEntry = kbEntryBySourceId.get(doc.knowledgeBaseId)
    if (!childKbId || !kbEntry) continue
    const childDocId = generateId()
    inserts.push({
      ...doc,
      id: childDocId,
      knowledgeBaseId: childKbId,
      connectorId: null,
      deletedAt: null,
      archivedAt: null,
    })
    record('knowledge_document', doc.id, childDocId)
    kbEntry.documentIdMap[doc.id] = childDocId
  }
  if (inserts.length > 0) await tx.insert(document).values(inserts)
}

/**
 * Plan the copy of documents referenced by the synced workflows whose parent knowledge base is
 * ALREADY mapped to an existing target KB (not copied this sync) but the document itself is not
 * mapped. For each, insert a placeholder document row into that existing target KB and return:
 *  - `documents`: content entries for the post-commit embeddings/blob fill,
 *  - `docIdMap`: source->child document id map (to augment the resolver so the `document-selector`
 *    reference remaps to the copy instead of being cleared),
 *  - `mappingEntries`: `knowledge_document` rows to persist (so a re-sync resolves the copy).
 *
 * FK-safe: the target KB is one the resolver returns (existence-checked via `validTargetIdsByKind`),
 * and the placeholder insert is a bounded in-tx write with no object-storage I/O. Documents whose
 * parent KB is being copied THIS sync are handled by {@link createForkDocumentPlaceholders} under
 * that copied KB and are excluded here via `alreadyCopiedSourceDocIds`. A referenced document whose
 * parent KB is not mapped at all is left untouched, so its reference is cleared as before.
 */
export async function planForkMappedKbDocumentCopies(params: {
  tx: DbOrTx
  resolver: ForkReferenceResolver
  referencedDocumentIds: string[]
  alreadyCopiedSourceDocIds: Set<string>
}): Promise<{
  documents: ForkContentDocumentEntry[]
  docIdMap: Map<string, string>
  mappingEntries: ForkMappingUpsert[]
}> {
  const { tx, resolver, referencedDocumentIds, alreadyCopiedSourceDocIds } = params
  const documents: ForkContentDocumentEntry[] = []
  const docIdMap = new Map<string, string>()
  const mappingEntries: ForkMappingUpsert[] = []

  // A doc whose parent KB is being copied this sync is placed under that copied KB (skip via
  // alreadyCopiedSourceDocIds); a doc that already resolves was mapped by a prior sync (skip via
  // the resolver). Everything else is a candidate to copy into its (existing) mapped target KB.
  const candidateIds = referencedDocumentIds.filter(
    (id) => !alreadyCopiedSourceDocIds.has(id) && resolver('knowledge-document', id) == null
  )
  if (candidateIds.length === 0) return { documents, docIdMap, mappingEntries }

  const docs = await tx
    .select()
    .from(document)
    .where(
      and(
        inArray(document.id, candidateIds),
        isNull(document.deletedAt),
        isNull(document.archivedAt)
      )
    )

  const inserts: (typeof document.$inferInsert)[] = []
  for (const doc of docs) {
    // The parent KB must already exist in the target. The resolver returns a target KB id only
    // for a mapped, still-existing KB (validTargetIdsByKind), so this is FK-safe; a doc whose KB
    // isn't mapped resolves null here and is left for its reference to be cleared.
    const targetKbId = resolver('knowledge-base', doc.knowledgeBaseId)
    if (targetKbId == null) continue
    const childDocId = generateId()
    inserts.push({
      ...doc,
      id: childDocId,
      knowledgeBaseId: targetKbId,
      connectorId: null,
      deletedAt: null,
      archivedAt: null,
    })
    docIdMap.set(doc.id, childDocId)
    mappingEntries.push({
      resourceType: 'knowledge_document',
      parentResourceId: doc.id,
      childResourceId: childDocId,
    })
    documents.push({
      sourceDocId: doc.id,
      childDocId,
      childKnowledgeBaseId: targetKbId,
      storageKey: doc.storageKey,
      filename: doc.filename,
      mimeType: doc.mimeType,
    })
  }
  if (inserts.length > 0) await tx.insert(document).values(inserts)
  return { documents, docIdMap, mappingEntries }
}

/**
 * Recursively rewrite the in-workspace resource URLs stored in a copied table row's `data` jsonb
 * (column -> value), so resource-chip cells keep resolving after a cross-workspace copy. Fast-rejects
 * a string without `/workspace/` before any regex, and returns the same reference when nothing
 * changed (so only rows with a rewritten cell allocate a new `data` object).
 */
function remapTableRowResourceUrls(value: unknown, maps: ForkContentRefMaps): unknown {
  if (typeof value === 'string') {
    if (!value.includes('/workspace/')) return value
    return rewriteForkResourceUrls(value, maps)
  }
  if (Array.isArray(value)) {
    let changed = false
    const next = value.map((item) => {
      const remapped = remapTableRowResourceUrls(item, maps)
      if (remapped !== item) changed = true
      return remapped
    })
    return changed ? next : value
  }
  if (isRecord(value)) {
    let changed = false
    const next: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      const remapped = remapTableRowResourceUrls(item, maps)
      if (remapped !== item) changed = true
      next[key] = remapped
    }
    return changed ? next : value
  }
  return value
}

/**
 * Copy the heavy resource content described by a {@link ForkContentPlan} AFTER the
 * fork transaction has committed: table rows, and KB documents + embeddings. Reads
 * and writes are keyset-paginated so peak memory is bounded to one page, and each
 * resource is copied in its own short statements (never one long transaction).
 * Best-effort: a failure on one resource is logged and the others continue - the
 * fork itself (workflows + container rows) already succeeded. Copied skill bodies are
 * RE-READ (keyset-paginated) and rewritten here too (`contentRefMaps`), out of the locked
 * fork tx; that rewrite is an in-content link fixup, so a failure degrades to a broken link
 * and never fails a resource.
 */
export async function copyForkResourceContent(params: {
  contentPlan: ForkContentPlan
  /** In-content reference maps for rewriting copied skill bodies post-commit (best-effort). */
  contentRefMaps?: ForkContentRefMaps
  requestId?: string
}): Promise<{ copied: number; failed: number; failures: ForkFailedResource[] }> {
  const { contentPlan, contentRefMaps, requestId = 'unknown' } = params
  const { childWorkspaceId, userId } = contentPlan

  let copiedResources = 0
  let failedResources = 0
  const failures: ForkFailedResource[] = []

  for (const table of contentPlan.tables) {
    try {
      let copied = 0
      let afterId: string | null = null
      for (;;) {
        const where: SQL<unknown> | undefined =
          afterId === null
            ? eq(userTableRows.tableId, table.sourceId)
            : and(eq(userTableRows.tableId, table.sourceId), gt(userTableRows.id, afterId))
        const rows = await db
          .select()
          .from(userTableRows)
          .where(where)
          .orderBy(asc(userTableRows.id))
          .limit(CONTENT_PAGE)
        if (rows.length === 0) break
        await db.insert(userTableRows).values(
          rows.map((row) => ({
            ...row,
            id: generateId(),
            tableId: table.childId,
            workspaceId: childWorkspaceId,
            // Repoint resource-chip URLs in cell data at the child copies (no-op when no maps).
            data: contentRefMaps ? remapTableRowResourceUrls(row.data, contentRefMaps) : row.data,
          }))
        )
        copied += rows.length
        afterId = rows[rows.length - 1].id
        if (rows.length < CONTENT_PAGE) break
      }
      await db
        .update(userTableDefinitions)
        .set({ rowCount: copied })
        .where(eq(userTableDefinitions.id, table.childId))
      copiedResources += 1
    } catch (error) {
      failedResources += 1
      failures.push({ kind: 'table', childId: table.childId })
      logger.warn(`[${requestId}] Failed to copy table rows during fork`, {
        sourceTableId: table.sourceId,
        error: getErrorMessage(error),
      })
    }
  }

  for (const kb of contentPlan.knowledgeBases) {
    try {
      let afterDocId: string | null = null
      for (;;) {
        // Only copy LIVE documents - exclude soft-deleted and archived rows, matching
        // how the rest of the KB system treats them as gone (chunks/tags/search filter
        // both). A fork must not resurrect documents removed from the source base.
        const liveDocs = and(
          eq(document.knowledgeBaseId, kb.sourceId),
          isNull(document.deletedAt),
          isNull(document.archivedAt)
        )
        const where: SQL<unknown> | undefined =
          afterDocId === null ? liveDocs : and(liveDocs, gt(document.id, afterDocId))
        const docs = await db
          .select()
          .from(document)
          .where(where)
          .orderBy(asc(document.id))
          .limit(CONTENT_PAGE)
        if (docs.length === 0) break
        // Copy the page's documents with bounded concurrency. The mapper never rejects
        // (it captures its error), so all in-flight work settles before this resolves - no
        // orphaned writes survive a failure - and a captured error is rethrown after to keep
        // the KB ALL-OR-NOTHING (any failed doc fails the whole KB -> cleanup below).
        const docErrors = await mapWithConcurrency(
          docs,
          KB_DOCUMENT_COPY_CONCURRENCY,
          async (doc): Promise<unknown> => {
            try {
              // Referenced documents were pre-created as placeholders in the fork tx at this
              // exact child id, so a remapped `document-selector` reference can't dangle; the
              // rest get a fresh id here. Copy the blob to a child-scoped KB key so the copy
              // never shares the source's object (best-effort - keeps the source key on failure).
              const placeholderId = kb.documentIdMap[doc.id]
              const childDocId = placeholderId ?? generateId()
              const blob = await copyKbDocumentBlob(doc, childWorkspaceId, userId, requestId)
              if (placeholderId) {
                if (blob) {
                  await db
                    .update(document)
                    .set({ storageKey: blob.storageKey, fileUrl: blob.fileUrl })
                    .where(eq(document.id, childDocId))
                }
              } else {
                await db.insert(document).values({
                  ...doc,
                  id: childDocId,
                  knowledgeBaseId: kb.childId,
                  connectorId: null,
                  deletedAt: null,
                  archivedAt: null,
                  ...(blob ? { storageKey: blob.storageKey, fileUrl: blob.fileUrl } : {}),
                })
              }
              await copyDocumentEmbeddings(doc.id, childDocId, kb.childId)
              return null
            } catch (error) {
              return error
            }
          }
        )
        const docError = docErrors.find((error) => error != null)
        if (docError) throw docError
        afterDocId = docs[docs.length - 1].id
        if (docs.length < CONTENT_PAGE) break
      }
      copiedResources += 1
    } catch (error) {
      failedResources += 1
      failures.push({
        kind: 'knowledge-base',
        childId: kb.childId,
        documentChildIds: Object.values(kb.documentIdMap),
      })
      logger.warn(`[${requestId}] Failed to copy knowledge base content during fork`, {
        sourceKnowledgeBaseId: kb.sourceId,
        error: getErrorMessage(error),
      })
    }
  }

  // Fill the documents copied into an already-existing target KB (sync-only U-docs path). The
  // placeholder rows were inserted in the promote tx; here we re-key each blob and copy its
  // embeddings into the existing KB. A per-document failure drops just that placeholder (its
  // embeddings cascade) and clears its `document-selector` references - the existing KB and its
  // own documents are never touched.
  for (const docEntry of contentPlan.documents) {
    try {
      const blob = await copyKbDocumentBlob(
        {
          storageKey: docEntry.storageKey,
          filename: docEntry.filename,
          mimeType: docEntry.mimeType,
        },
        childWorkspaceId,
        userId,
        requestId
      )
      if (blob) {
        await db
          .update(document)
          .set({ storageKey: blob.storageKey, fileUrl: blob.fileUrl })
          .where(eq(document.id, docEntry.childDocId))
      }
      await copyDocumentEmbeddings(
        docEntry.sourceDocId,
        docEntry.childDocId,
        docEntry.childKnowledgeBaseId
      )
      copiedResources += 1
    } catch (error) {
      failedResources += 1
      failures.push({ kind: 'knowledge-document', childId: docEntry.childDocId })
      logger.warn(`[${requestId}] Failed to copy document into mapped KB during sync`, {
        sourceDocumentId: docEntry.sourceDocId,
        error: getErrorMessage(error),
      })
    }
  }

  // Rewrite copied skill bodies out of the locked fork tx (the rows were inserted with the source
  // body via an in-DB copy). RE-READ each child body keyset-paginated - it is never carried in the
  // job payload - remap its `sim:` links + embedded file URLs to the child resources, and write it
  // back. An in-content link fixup: a per-skill failure degrades to a broken link and is never
  // counted as a failed resource (unmapped targets are left as graceful broken links).
  if (contentRefMaps && contentPlan.skills.length > 0) {
    const childSkillIds = contentPlan.skills.map((entry) => entry.childId)
    let afterId: string | null = null
    for (;;) {
      const where: SQL<unknown> | undefined =
        afterId === null
          ? inArray(skill.id, childSkillIds)
          : and(inArray(skill.id, childSkillIds), gt(skill.id, afterId))
      const rows = await db
        .select({ id: skill.id, content: skill.content })
        .from(skill)
        .where(where)
        .orderBy(asc(skill.id))
        .limit(CONTENT_PAGE)
      if (rows.length === 0) break
      // Bounded fan-out: the mapper never rejects (it captures its own error), so mapWithConcurrency
      // settles the whole page. A rewrite is a best-effort link fixup, so a per-skill failure is
      // logged and the body keeps its source links rather than failing a resource.
      await mapWithConcurrency(rows, SKILL_REWRITE_CONCURRENCY, async (row): Promise<void> => {
        try {
          const rewritten = rewriteForkContentRefs(row.content, contentRefMaps)
          if (rewritten !== row.content) {
            await db.update(skill).set({ content: rewritten }).where(eq(skill.id, row.id))
          }
        } catch (error) {
          logger.warn(
            `[${requestId}] Failed to rewrite copied skill content; keeping source links`,
            {
              childSkillId: row.id,
              error: getErrorMessage(error),
            }
          )
        }
      })
      afterId = rows[rows.length - 1].id
      if (rows.length < CONTENT_PAGE) break
    }
  }

  return { copied: copiedResources, failed: failedResources, failures }
}

async function copyDocumentEmbeddings(
  sourceDocumentId: string,
  childDocumentId: string,
  childKnowledgeBaseId: string
): Promise<void> {
  let afterId: string | null = null
  for (;;) {
    const where: SQL<unknown> | undefined =
      afterId === null
        ? eq(embedding.documentId, sourceDocumentId)
        : and(eq(embedding.documentId, sourceDocumentId), gt(embedding.id, afterId))
    const rows = await db
      .select()
      .from(embedding)
      .where(where)
      .orderBy(asc(embedding.id))
      .limit(CONTENT_PAGE)
    if (rows.length === 0) break
    await db.insert(embedding).values(
      rows.map((row) => ({
        ...row,
        id: generateId(),
        documentId: childDocumentId,
        knowledgeBaseId: childKnowledgeBaseId,
      }))
    )
    afterId = rows[rows.length - 1].id
    if (rows.length < CONTENT_PAGE) break
  }
}

/**
 * Duplicate a KB document's stored blob to a fresh child-scoped KB storage key so the copied
 * document never points at the source's object. The child key is written with a `file_metadata`
 * ownership binding owned by the CHILD workspace (mirroring the canonical KB upload), so
 * `verifyKBFileAccess` grants a child-workspace member - without it the copied object is
 * download-denied (no binding = deny). Returns the new `storageKey` + serve `fileUrl`, or null
 * when there is no internal blob to copy (external/`data:` docs have a null `storageKey`) or the
 * copy fails - best-effort, so a single blob failure never aborts the KB.
 */
async function copyKbDocumentBlob(
  doc: { storageKey: string | null; filename: string; mimeType: string },
  childWorkspaceId: string,
  userId: string,
  requestId: string
): Promise<{ storageKey: string; fileUrl: string } | null> {
  if (!doc.storageKey) return null
  try {
    const buffer = await downloadFile({
      key: doc.storageKey,
      context: 'knowledge-base',
      maxBytes: MAX_FILE_SIZE,
    })
    const targetKey = generateKnowledgeBaseFileKey(doc.filename)
    await uploadFile({
      file: buffer,
      fileName: doc.filename,
      contentType: doc.mimeType,
      context: 'knowledge-base',
      customKey: targetKey,
      preserveKey: true,
      metadata: {
        userId,
        workspaceId: childWorkspaceId,
        originalName: doc.filename,
      },
    })
    return { storageKey: targetKey, fileUrl: `/api/files/serve/${encodeURIComponent(targetKey)}` }
  } catch (error) {
    logger.warn(`[${requestId}] Failed to copy KB document blob during fork; keeping source key`, {
      sourceStorageKey: doc.storageKey,
      error: getErrorMessage(error),
    })
    return null
  }
}
