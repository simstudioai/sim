import { db } from '@sim/db'
import {
  customTools,
  document,
  embedding,
  knowledgeBase,
  knowledgeBaseTagDefinitions,
  mcpServers,
  permissions,
  skill,
  skillMember,
  userTableDefinitions,
  userTableRows,
  workflowMcpServer,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { omit } from '@sim/utils/object'
import { and, asc, eq, gt, inArray, isNotNull, isNull, type SQL, sql } from 'drizzle-orm'
import {
  decrementStorageUsageForBillingContextInTx,
  incrementStorageUsageForBillingContextInTx,
  resolveStorageBillingContext,
  type StorageBillingContext,
} from '@/lib/billing/storage'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import type { DbOrTx } from '@/lib/db/types'
import type { TableSchema } from '@/lib/table/types'
import {
  deleteFile,
  downloadFile,
  headObject,
  uploadFile,
} from '@/lib/uploads/core/storage-service'
import { MAX_FILE_SIZE } from '@/lib/uploads/utils/validation'
import { isRecord } from '@/lib/workflows/persistence/remap-internal-ids'
import type {
  ForkMappingUpsert,
  ForkResourceType,
} from '@/ee/workspace-forking/lib/mapping/mapping-store'
import type { ForkBlockIdResolver } from '@/ee/workspace-forking/lib/remap/block-identity'
import {
  type ForkContentRefMaps,
  rewriteForkContentRefs,
  rewriteForkResourceUrls,
} from '@/ee/workspace-forking/lib/remap/remap-content-refs'
import {
  type ForkReferenceResolver,
  rewriteEnvRefsInText,
} from '@/ee/workspace-forking/lib/remap/remap-references'
import { remapForkTableWorkflowGroups } from '@/ee/workspace-forking/lib/remap/remap-table-groups'

const logger = createLogger('WorkspaceForkCopyResources')

/** Page size for the post-transaction bulk content copy (keyset-paginated). */
const CONTENT_PAGE = 500

/**
 * Max documents copied concurrently within one KB page. Bounds fan-out (blob copy + per-doc
 * embedding paging) so a large page doesn't issue every request at once; the keyset loop still
 * processes one page at a time, so peak concurrency stays at this cap regardless of KB size.
 */
const KB_DOCUMENT_COPY_CONCURRENCY = 5

function deriveCopyIdentity(
  kind: 'document' | 'embedding',
  targetId: string,
  sourceId: string
): string {
  const digest = sha256Hex(`${kind}:${targetId}:${sourceId}`).slice(0, 40)
  return `fork_${kind}_${digest}`
}

/** Stable object key so a replay overwrites or reuses the same copied KB blob. */
function deriveKbDocumentStorageKey(childDocumentId: string): string {
  return `kb/fork-${childDocumentId}`
}

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
    /** External MCP servers, copied as config rows (fork-only; sync resolves them by mapping). */
    mcpServers: string[]
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
  fileUrl: string
  fileSize: number
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
  mcpServers: string[]
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
    mcpServers: [],
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
    const childSkillIdBySource = new Map<string, string>()
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
      childSkillIdBySource.set(row.id, childId)
      record('skill', row.id, childId)
      contentPlan.skills.push({ childId })
      names.skills.push(row.name)
    }
    if (inserts.length > 0) {
      await tx.insert(skill).values(inserts)

      // Copy editor grants for users who are members of the child workspace.
      // Workspace admins need no rows — they are derived editors in the child
      // too (mirrors credential member propagation otherwise).
      const memberRows = await tx
        .select({
          skillId: skillMember.skillId,
          userId: skillMember.userId,
        })
        .from(skillMember)
        .innerJoin(
          permissions,
          and(
            eq(permissions.userId, skillMember.userId),
            eq(permissions.entityType, 'workspace'),
            eq(permissions.entityId, childWorkspaceId)
          )
        )
        .where(inArray(skillMember.skillId, Array.from(childSkillIdBySource.keys())))
      const memberInserts = memberRows.flatMap((member) => {
        const childSkillId = childSkillIdBySource.get(member.skillId)
        if (!childSkillId) return []
        return [
          {
            id: generateId(),
            skillId: childSkillId,
            userId: member.userId,
            createdAt: now,
            updatedAt: now,
          },
        ]
      })
      if (memberInserts.length > 0) {
        await tx
          .insert(skillMember)
          .values(memberInserts)
          .onConflictDoNothing({ target: [skillMember.skillId, skillMember.userId] })
      }
    }
  }

  if (selection.mcpServers.length > 0) {
    const rows = await tx
      .select()
      .from(mcpServers)
      .where(
        and(
          inArray(mcpServers.id, selection.mcpServers),
          eq(mcpServers.workspaceId, sourceWorkspaceId),
          isNull(mcpServers.deletedAt)
        )
      )
    // Copy external MCP servers as CONFIG rows: transport/url/headers (and pre-registered OAuth
    // client info) verbatim - the forking admin can already read them in the source. OAuth
    // tokens (`mcp_server_oauth`) are never copied: an oauth-auth server lands disconnected in
    // the child until re-authorized. Runtime status resets to a clean slate - the tool cache is
    // workspace-keyed, so the child's first tool-selector open / execution re-discovers tools
    // fresh; subblock tool SELECTIONS remap onto the copied server id (tool names carry over).
    // `{{ENV}}` refs in the url/headers are rewritten through the env-name resolver when a sync
    // renames an env var (fork passes no resolver - names preserve verbatim), mirroring the
    // custom-tool `code` rewrite.
    const rewriteEnv = (value: string): string =>
      resolveEnvName ? rewriteEnvRefsInText(value, resolveEnvName) : value
    const inserts: (typeof mcpServers.$inferInsert)[] = []
    for (const row of rows) {
      const childId = generateId()
      const headers = isRecord(row.headers)
        ? Object.fromEntries(
            Object.entries(row.headers).map(([key, value]) => [
              key,
              typeof value === 'string' ? rewriteEnv(value) : value,
            ])
          )
        : row.headers
      inserts.push({
        ...row,
        id: childId,
        workspaceId: childWorkspaceId,
        createdBy: userId,
        url: typeof row.url === 'string' ? rewriteEnv(row.url) : row.url,
        headers,
        // Normalize legacy `http`/`sse` transports to the only supported value so a
        // forked row never carries a transport the API contract would reject.
        transport: 'streamable-http',
        connectionStatus: 'disconnected',
        lastConnected: null,
        lastError: null,
        statusConfig: { consecutiveFailures: 0, lastSuccessfulDiscovery: null },
        toolCount: 0,
        lastToolsRefresh: null,
        totalRequests: 0,
        lastUsed: null,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      record('mcp_server', row.id, childId)
      names.mcpServers.push(row.name)
    }
    if (inserts.length > 0) await tx.insert(mcpServers).values(inserts)
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
    // (name/description/visibility) with NO `workflow_mcp_tool` rows attached - the child's
    // attachments are seeded by the chat/attachment carry-over and re-derived on deploy. The
    // shell copy IS recorded in the fork resource map (`workflow_mcp_server` identity), so a
    // later sync can mirror `workflow_mcp_tool` attachments onto the mapped counterpart.
    const inserts: (typeof workflowMcpServer.$inferInsert)[] = []
    for (const row of rows) {
      const childId = generateId()
      inserts.push({
        ...row,
        id: childId,
        workspaceId: childWorkspaceId,
        createdBy: userId,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      record('workflow_mcp_server', row.id, childId)
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
      now,
      record,
    })
  }

  return { idMap, mappingEntries, contentPlan, names }
}

/**
 * Insert placeholder {@link document} rows in the child KBs for the referenced documents
 * whose parent KB is being copied, recording the `knowledge_document` source->child id map.
 * Each deterministic placeholder is archived with no storage key and zero bytes, so it is
 * non-billable until {@link copyForkResourceContent} activates it atomically with accounting.
 * Documents whose parent KB is not copied are skipped, leaving their references to be cleared.
 */
async function createForkDocumentPlaceholders(params: {
  tx: DbOrTx
  kbIdMap: Map<string, string>
  kbEntryBySourceId: Map<string, ForkContentKbEntry>
  referencedDocumentIds: string[]
  now: Date
  record: (type: ForkResourceType, sourceId: string, childId: string) => void
}): Promise<void> {
  const { tx, kbIdMap, kbEntryBySourceId, referencedDocumentIds, now, record } = params
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
    const childDocId = deriveCopyIdentity('document', childKbId, doc.id)
    inserts.push({
      ...doc,
      id: childDocId,
      knowledgeBaseId: childKbId,
      connectorId: null,
      storageKey: null,
      fileUrl: '',
      fileSize: 0,
      deletedAt: null,
      archivedAt: now,
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
 * and the placeholder insert is a bounded, non-billable in-tx write with no object-storage I/O.
 * Documents whose parent KB is being copied THIS sync are handled by
 * {@link createForkDocumentPlaceholders} under that copied KB and are excluded here via
 * `alreadyCopiedSourceDocIds`. A referenced document whose parent KB is not mapped at all is left
 * untouched, so its reference is cleared as before.
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
    const childDocId = deriveCopyIdentity('document', targetKbId, doc.id)
    inserts.push({
      ...doc,
      id: childDocId,
      knowledgeBaseId: targetKbId,
      connectorId: null,
      storageKey: null,
      fileUrl: '',
      fileSize: 0,
      deletedAt: null,
      archivedAt: new Date(),
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
      fileUrl: doc.fileUrl,
      fileSize: doc.fileSize,
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
  let billingContext: StorageBillingContext | null = null
  const getBillingContext = async (): Promise<StorageBillingContext> => {
    billingContext ??= await resolveStorageBillingContext(childWorkspaceId)
    return billingContext
  }

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
        const documentCopies = docs.map((source) => ({
          source,
          childDocumentId:
            kb.documentIdMap[source.id] ?? deriveCopyIdentity('document', kb.childId, source.id),
        }))
        const activeTargetDocumentIds = await getActiveTargetDocumentIds(
          documentCopies.map(({ childDocumentId }) => childDocumentId)
        )
        const documentsToCopy = documentCopies.filter(
          ({ childDocumentId }) => !activeTargetDocumentIds.has(childDocumentId)
        )
        // Copy the page's documents with bounded concurrency. The mapper never rejects
        // (it captures its error), so all in-flight work settles before this resolves - no
        // orphaned writes survive a failure - and a captured error is rethrown after to keep
        // the KB ALL-OR-NOTHING (any failed doc fails the whole KB -> cleanup below).
        if (documentsToCopy.length > 0) {
          const resolvedBillingContext = await getBillingContext()
          const docErrors = await mapWithConcurrency(
            documentsToCopy,
            KB_DOCUMENT_COPY_CONCURRENCY,
            async ({ source, childDocumentId }): Promise<unknown> => {
              try {
                await copyKbDocument({
                  source,
                  childDocumentId,
                  childKnowledgeBaseId: kb.childId,
                  childWorkspaceId,
                  userId,
                  billingContext: resolvedBillingContext,
                })
                return null
              } catch (error) {
                return error
              }
            }
          )
          const docError = docErrors.find((error) => error != null)
          if (docError) throw docError
        }
        afterDocId = docs[docs.length - 1].id
        if (docs.length < CONTENT_PAGE) break
      }
      copiedResources += 1
    } catch (error) {
      try {
        await rollbackCopiedKbDocuments(kb.childId, childWorkspaceId)
      } catch (rollbackError) {
        logger.error(`[${requestId}] Failed to roll back copied KB storage accounting`, {
          childKnowledgeBaseId: kb.childId,
          error: getErrorMessage(rollbackError),
        })
        throw new Error(
          `Copied knowledge base ${kb.childId} failed and its storage rollback also failed: ${getErrorMessage(rollbackError)}`,
          { cause: rollbackError }
        )
      }
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
      const active = await isActiveTargetDocument(docEntry.childDocId)
      if (active) {
        copiedResources += 1
        continue
      }
      const resolvedBillingContext = await getBillingContext()
      const blob = await copyKbDocumentBlob(
        {
          storageKey: docEntry.storageKey,
          filename: docEntry.filename,
          mimeType: docEntry.mimeType,
        },
        childWorkspaceId,
        userId,
        docEntry.childDocId
      )
      try {
        await copyDocumentEmbeddings(
          docEntry.sourceDocId,
          docEntry.childDocId,
          docEntry.childKnowledgeBaseId
        )
        await finalizeKbDocument({
          childDocumentId: docEntry.childDocId,
          childKnowledgeBaseId: docEntry.childKnowledgeBaseId,
          billingContext: resolvedBillingContext,
          bytes: blob ? docEntry.fileSize : 0,
          values: {
            knowledgeBaseId: docEntry.childKnowledgeBaseId,
            connectorId: null,
            storageKey: blob?.storageKey ?? null,
            fileUrl: blob?.fileUrl ?? docEntry.fileUrl,
            fileSize: docEntry.fileSize,
            archivedAt: null,
            deletedAt: null,
            uploadedBy: userId,
          },
        })
      } catch (error) {
        if (blob) await cleanupCopiedKbBlob(blob.storageKey)
        throw error
      }
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

async function getActiveTargetDocumentIds(childDocumentIds: string[]): Promise<Set<string>> {
  if (childDocumentIds.length === 0) return new Set()
  const active = await db
    .select({ id: document.id })
    .from(document)
    .where(
      and(
        inArray(document.id, childDocumentIds),
        isNull(document.deletedAt),
        isNull(document.archivedAt)
      )
    )
    .limit(childDocumentIds.length)
  return new Set(active.map((row) => row.id))
}

async function isActiveTargetDocument(childDocumentId: string): Promise<boolean> {
  return (await getActiveTargetDocumentIds([childDocumentId])).has(childDocumentId)
}

/**
 * Ensure embeddings have an FK target before external copy. The placeholder is
 * deliberately non-billable (`archivedAt`, null storage key, zero bytes) and only
 * {@link finalizeKbDocument} can activate it in the accounting transaction.
 */
async function ensureKbDocumentPlaceholder(
  source: typeof document.$inferSelect,
  childDocumentId: string,
  childKnowledgeBaseId: string,
  userId: string
): Promise<void> {
  await db
    .insert(document)
    .values({
      ...source,
      id: childDocumentId,
      knowledgeBaseId: childKnowledgeBaseId,
      connectorId: null,
      storageKey: null,
      fileUrl: '',
      fileSize: 0,
      archivedAt: new Date(),
      deletedAt: null,
      uploadedBy: userId,
    })
    .onConflictDoNothing({ target: document.id })
}

/**
 * Activate one copied document and increment the target workspace plus payer as
 * one transaction. The archived-placeholder predicate is the replay guard: only
 * the transaction that activates it receives a row from `RETURNING` and charges.
 */
async function finalizeKbDocument(params: {
  childDocumentId: string
  childKnowledgeBaseId: string
  billingContext: StorageBillingContext
  bytes: number
  values: Partial<typeof document.$inferInsert>
}): Promise<void> {
  const { childDocumentId, childKnowledgeBaseId, billingContext, bytes, values } = params
  await db.transaction(async (tx) => {
    const [lockedKnowledgeBase] = await tx
      .select({ workspaceId: knowledgeBase.workspaceId })
      .from(knowledgeBase)
      .where(eq(knowledgeBase.id, childKnowledgeBaseId))
      .for('update')
    if (!lockedKnowledgeBase) {
      throw new Error(`Copied document knowledge base ${childKnowledgeBaseId} is missing`)
    }
    if (lockedKnowledgeBase.workspaceId !== billingContext.workspaceId) {
      throw new Error(
        `Copied document knowledge base ${childKnowledgeBaseId} moved from workspace ${billingContext.workspaceId}; refusing stale storage charge`
      )
    }

    const [activated] = await tx
      .update(document)
      .set(values)
      .where(
        and(
          eq(document.id, childDocumentId),
          isNull(document.deletedAt),
          isNotNull(document.archivedAt)
        )
      )
      .returning({ id: document.id })

    if (!activated) {
      const [active] = await tx
        .select({ id: document.id })
        .from(document)
        .where(
          and(
            eq(document.id, childDocumentId),
            isNull(document.deletedAt),
            isNull(document.archivedAt)
          )
        )
        .limit(1)
      if (active) return
      throw new Error(`Copied document placeholder ${childDocumentId} is missing`)
    }

    await incrementStorageUsageForBillingContextInTx(tx, billingContext, bytes)
  })
}

/**
 * Copy one full-KB document without external I/O in a transaction. Embeddings and
 * the blob are replay-safe via deterministic identities; activation is the final
 * step, so a failed copy leaves only a non-billable archived placeholder.
 */
async function copyKbDocument(params: {
  source: typeof document.$inferSelect
  childDocumentId: string
  childKnowledgeBaseId: string
  childWorkspaceId: string
  userId: string
  billingContext: StorageBillingContext
}): Promise<void> {
  const {
    source,
    childDocumentId,
    childKnowledgeBaseId,
    childWorkspaceId,
    userId,
    billingContext,
  } = params
  await ensureKbDocumentPlaceholder(source, childDocumentId, childKnowledgeBaseId, userId)

  const blob = await copyKbDocumentBlob(source, childWorkspaceId, userId, childDocumentId)
  try {
    await copyDocumentEmbeddings(source.id, childDocumentId, childKnowledgeBaseId)
    await finalizeKbDocument({
      childDocumentId,
      childKnowledgeBaseId,
      billingContext,
      bytes: blob ? source.fileSize : 0,
      values: {
        ...omit(source, ['id', 'knowledgeBaseId']),
        knowledgeBaseId: childKnowledgeBaseId,
        connectorId: null,
        storageKey: blob?.storageKey ?? null,
        fileUrl: blob?.fileUrl ?? source.fileUrl,
        archivedAt: null,
        deletedAt: null,
        uploadedBy: userId,
      },
    })
  } catch (error) {
    if (blob) await cleanupCopiedKbBlob(blob.storageKey)
    throw error
  }
}

/**
 * Reverse any documents already activated for a KB when a later document fails,
 * preserving the existing all-or-nothing KB failure semantics without a long
 * parent transaction. The aggregate keeps memory bounded regardless of KB size.
 */
async function rollbackCopiedKbDocuments(
  childKnowledgeBaseId: string,
  childWorkspaceId: string
): Promise<void> {
  const billingContext = await resolveStorageBillingContext(childWorkspaceId)
  await db.transaction(async (tx) => {
    const [lockedKnowledgeBase] = await tx
      .select({ workspaceId: knowledgeBase.workspaceId })
      .from(knowledgeBase)
      .where(eq(knowledgeBase.id, childKnowledgeBaseId))
      .for('update')
    if (!lockedKnowledgeBase || lockedKnowledgeBase.workspaceId !== childWorkspaceId) {
      throw new Error(
        `Copied knowledge base ${childKnowledgeBaseId} moved from workspace ${childWorkspaceId}; refusing stale storage rollback`
      )
    }

    const [usage] = await tx
      .select({ total: sql<string>`coalesce(sum(${document.fileSize}), 0)` })
      .from(document)
      .where(
        and(
          eq(document.knowledgeBaseId, childKnowledgeBaseId),
          isNull(document.deletedAt),
          isNull(document.archivedAt),
          isNotNull(document.storageKey)
        )
      )
    const bytes = Number(usage?.total ?? 0)
    await decrementStorageUsageForBillingContextInTx(tx, billingContext, bytes)
    await tx
      .update(document)
      .set({ archivedAt: new Date() })
      .where(
        and(
          eq(document.knowledgeBaseId, childKnowledgeBaseId),
          isNull(document.deletedAt),
          isNull(document.archivedAt)
        )
      )
  })
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
    await db
      .insert(embedding)
      .values(
        rows.map((row) => ({
          ...row,
          id: deriveCopyIdentity('embedding', childDocumentId, row.id),
          documentId: childDocumentId,
          knowledgeBaseId: childKnowledgeBaseId,
        }))
      )
      .onConflictDoNothing({ target: embedding.id })
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
 * copy fails. A stored source blob is required to copy successfully; callers
 * keep the target placeholder archived and report the existing resource failure.
 */
async function copyKbDocumentBlob(
  doc: { storageKey: string | null; filename: string; mimeType: string },
  childWorkspaceId: string,
  userId: string,
  childDocumentId: string
): Promise<{ storageKey: string; fileUrl: string } | null> {
  if (!doc.storageKey) return null
  const targetKey = deriveKbDocumentStorageKey(childDocumentId)
  try {
    const existing = await headObject(targetKey, 'knowledge-base')
    if (!existing) {
      const buffer = await downloadFile({
        key: doc.storageKey,
        context: 'knowledge-base',
        maxBytes: MAX_FILE_SIZE,
      })
      await uploadFile({
        file: buffer,
        fileName: doc.filename,
        contentType: doc.mimeType,
        context: 'knowledge-base',
        customKey: targetKey,
        preserveKey: true,
        persistMetadata: false,
        metadata: {
          userId,
          workspaceId: childWorkspaceId,
          originalName: doc.filename,
        },
      })
    }
  } catch (error) {
    await cleanupCopiedKbBlob(targetKey)
    throw error
  }
  return { storageKey: targetKey, fileUrl: `/api/files/serve/${encodeURIComponent(targetKey)}` }
}

/** Best-effort orphan cleanup after DB finalization or embedding copy fails. */
async function cleanupCopiedKbBlob(storageKey: string): Promise<void> {
  await deleteFile({ key: storageKey, context: 'knowledge-base' }).catch(() => {})
}
