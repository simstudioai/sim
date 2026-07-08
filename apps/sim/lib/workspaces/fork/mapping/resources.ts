import {
  credential,
  customTools,
  document,
  knowledgeBase,
  mcpServers,
  skill,
  userTableDefinitions,
  workflow,
  workflowDeploymentVersion,
  workflowMcpServer,
  workspaceEnvironment,
  workspaceFileFolder,
  workspaceFiles,
} from '@sim/db/schema'
import { and, count, eq, exists, inArray, isNull, sql } from 'drizzle-orm'
import type { ForkCopyableKind } from '@/lib/api/contracts/workspace-fork'
import type { DbOrTx } from '@/lib/db/types'
import type { ForkResourceType } from '@/lib/workspaces/fork/mapping/mapping-store'
import type { ForkMcpServerMeta, ForkRemapKind } from '@/lib/workspaces/fork/remap/remap-references'

export interface ForkResourceCandidate {
  id: string
  label: string
  providerId?: string
}

export const CANDIDATE_LIMIT = 1000

/** The set of env-var keys defined in a workspace (for resolver identity + gating). */
export async function getWorkspaceEnvKeys(
  executor: DbOrTx,
  workspaceId: string
): Promise<Set<string>> {
  const [row] = await executor
    .select({ variables: workspaceEnvironment.variables })
    .from(workspaceEnvironment)
    .where(eq(workspaceEnvironment.workspaceId, workspaceId))
    .limit(1)
  const variables = row?.variables
  if (!variables || typeof variables !== 'object') return new Set()
  return new Set(Object.keys(variables as Record<string, unknown>))
}

// Shared `{ id, label }` candidate queries for the content resource kinds that BOTH the
// mapping-target picker and the fork-copy picker list - one source of the archived/deleted
// filters so the two pickers can never drift apart, and one optional `ids` filter so the picker
// path (unfiltered, capped) and the existence/label path (exact ids) share a single definition
// per kind. When `ids` is given the query is filtered to those exact ids and is NOT capped, so a
// valid target sitting past the candidate cap is never wrongly dropped. Credentials, env vars
// (mapping-only), and files-with-folder (copy-only) keep their own helpers below.
const tableCandidatesQuery = (executor: DbOrTx, workspaceId: string, ids?: string[]) => {
  const query = executor
    .select({ id: userTableDefinitions.id, label: userTableDefinitions.name })
    .from(userTableDefinitions)
    .where(
      and(
        eq(userTableDefinitions.workspaceId, workspaceId),
        isNull(userTableDefinitions.archivedAt),
        ids ? inArray(userTableDefinitions.id, ids) : undefined
      )
    )
  return ids ? query : query.limit(CANDIDATE_LIMIT)
}

const knowledgeBaseCandidatesQuery = (executor: DbOrTx, workspaceId: string, ids?: string[]) => {
  const query = executor
    .select({ id: knowledgeBase.id, label: knowledgeBase.name })
    .from(knowledgeBase)
    .where(
      and(
        eq(knowledgeBase.workspaceId, workspaceId),
        isNull(knowledgeBase.deletedAt),
        ids ? inArray(knowledgeBase.id, ids) : undefined
      )
    )
  return ids ? query : query.limit(CANDIDATE_LIMIT)
}

const customToolCandidatesQuery = (executor: DbOrTx, workspaceId: string, ids?: string[]) => {
  const query = executor
    .select({ id: customTools.id, label: customTools.title })
    .from(customTools)
    .where(
      and(eq(customTools.workspaceId, workspaceId), ids ? inArray(customTools.id, ids) : undefined)
    )
  return ids ? query : query.limit(CANDIDATE_LIMIT)
}

const skillCandidatesQuery = (executor: DbOrTx, workspaceId: string, ids?: string[]) => {
  const query = executor
    .select({ id: skill.id, label: skill.name })
    .from(skill)
    .where(and(eq(skill.workspaceId, workspaceId), ids ? inArray(skill.id, ids) : undefined))
  return ids ? query : query.limit(CANDIDATE_LIMIT)
}

const mcpServerCandidatesQuery = (executor: DbOrTx, workspaceId: string, ids?: string[]) => {
  const query = executor
    .select({ id: mcpServers.id, label: mcpServers.name })
    .from(mcpServers)
    .where(
      and(
        eq(mcpServers.workspaceId, workspaceId),
        isNull(mcpServers.deletedAt),
        ids ? inArray(mcpServers.id, ids) : undefined
      )
    )
  return ids ? query : query.limit(CANDIDATE_LIMIT)
}

// Workspace-file mapping candidates are keyed by STORAGE KEY (not `workspace_files.id`): a
// `file-upload` reference stores the storage key, so a mapping target must be a key too. Only
// durable, non-deleted `workspace` files are mappable (chat/copilot uploads are session-scoped).
// An optional `keys` filter shares this definition between the mapping picker (unfiltered, capped)
// and the cap-free existence check.
const fileCandidatesQuery = (executor: DbOrTx, workspaceId: string, keys?: string[]) => {
  const query = executor
    .select({
      id: workspaceFiles.key,
      label: sql<string>`coalesce(${workspaceFiles.displayName}, ${workspaceFiles.originalName})`,
    })
    .from(workspaceFiles)
    .where(
      and(
        eq(workspaceFiles.workspaceId, workspaceId),
        eq(workspaceFiles.context, 'workspace'),
        isNull(workspaceFiles.deletedAt),
        keys ? inArray(workspaceFiles.key, keys) : undefined
      )
    )
  return keys ? query : query.limit(CANDIDATE_LIMIT)
}

// Copyable workspace files WITH their folder grouping (LEFT JOIN gated on a live folder, so a file
// whose folder was deleted shows ungrouped). Shared by the fork-copy picker (unfiltered, capped)
// and the promote copyable-label lookup (filtered by exact storage keys, never capped), so the
// file+folder shape and its filters live in one place. Selects both the row id and the storage
// key; the copy picker reads `id`, the key-addressed label lookup reads `key`.
const fileCandidatesWithFolderQuery = (
  executor: DbOrTx,
  workspaceId: string,
  options: { keys?: string[] } = {}
) => {
  const { keys } = options
  const query = executor
    .select({
      id: workspaceFiles.id,
      key: workspaceFiles.key,
      label: sql<string>`coalesce(${workspaceFiles.displayName}, ${workspaceFiles.originalName})`,
      folderId: workspaceFiles.folderId,
      folderName: workspaceFileFolder.name,
    })
    .from(workspaceFiles)
    .leftJoin(
      workspaceFileFolder,
      and(
        eq(workspaceFiles.folderId, workspaceFileFolder.id),
        isNull(workspaceFileFolder.deletedAt)
      )
    )
    .where(
      and(
        eq(workspaceFiles.workspaceId, workspaceId),
        eq(workspaceFiles.context, 'workspace'),
        isNull(workspaceFiles.deletedAt),
        keys ? inArray(workspaceFiles.key, keys) : undefined
      )
    )
  return keys ? query : query.limit(CANDIDATE_LIMIT)
}

/**
 * List the resources in a workspace that can serve as mapping targets, grouped by
 * remap kind. Used to populate the mapping UI's target pickers and to label the
 * source resources being mapped. `knowledge-document` is intentionally left empty:
 * documents are not a standalone mappable kind - they are dependent fields of their
 * knowledge base, re-picked in the per-KB reconfigure flow (and auto-remapped when
 * their KB is copied). `file` candidates are keyed by storage key.
 */
export async function listForkResourceCandidates(
  executor: DbOrTx,
  workspaceId: string
): Promise<Record<ForkRemapKind, ForkResourceCandidate[]>> {
  const [creds, wsEnvRows, tables, kbs, servers, tools, skills, files] = await Promise.all([
    executor
      .select({
        id: credential.id,
        displayName: credential.displayName,
        providerId: credential.providerId,
      })
      .from(credential)
      // Only real connections are mappable credentials. `env_workspace`/`env_personal`
      // rows live in the same table but are environment variables (surfaced via the
      // 'env-var' kind), so they must never appear as credential targets.
      .where(
        and(
          eq(credential.workspaceId, workspaceId),
          inArray(credential.type, ['oauth', 'service_account'])
        )
      )
      .limit(CANDIDATE_LIMIT),
    executor
      .select({ variables: workspaceEnvironment.variables })
      .from(workspaceEnvironment)
      .where(eq(workspaceEnvironment.workspaceId, workspaceId))
      .limit(1),
    tableCandidatesQuery(executor, workspaceId),
    knowledgeBaseCandidatesQuery(executor, workspaceId),
    mcpServerCandidatesQuery(executor, workspaceId),
    customToolCandidatesQuery(executor, workspaceId),
    skillCandidatesQuery(executor, workspaceId),
    fileCandidatesQuery(executor, workspaceId),
  ])

  const envVariables = wsEnvRows[0]?.variables
  const envKeys =
    envVariables && typeof envVariables === 'object'
      ? Object.keys(envVariables as Record<string, unknown>)
      : []

  return {
    credential: creds.map((c) => ({
      id: c.id,
      label: c.displayName,
      providerId: c.providerId ?? undefined,
    })),
    'env-var': envKeys.map((key) => ({ id: key, label: key })),
    table: tables,
    'knowledge-base': kbs,
    'mcp-server': servers,
    'custom-tool': tools,
    skill: skills,
    'knowledge-document': [],
    file: files,
  }
}

/**
 * Given mapped target ids grouped by kind, return the subset that still EXISTS in the
 * target workspace (same archived/deleted filters as `listForkResourceCandidates`).
 * Used at promote time so a mapping whose target was deleted after it was saved
 * resolves as unmapped (surfaced/cleared) instead of writing a dead id into the
 * promoted workflow. Queries the exact ids (not the capped candidate list) so a valid
 * target is never wrongly dropped, and only the DB-backed kinds are checked - env-var
 * existence is handled by the resolver's `targetEnvKeys`, and `file`/`workflow` are
 * resolved by other paths.
 */
export async function filterExistingForkTargets(
  executor: DbOrTx,
  workspaceId: string,
  idsByKind: Partial<Record<ForkRemapKind, Set<string>>>
): Promise<Partial<Record<ForkRemapKind, Set<string>>>> {
  const ids = (kind: ForkRemapKind): string[] => {
    const set = idsByKind[kind]
    return set && set.size > 0 ? Array.from(set) : []
  }
  const credIds = ids('credential')
  const tableIds = ids('table')
  const kbIds = ids('knowledge-base')
  const docIds = ids('knowledge-document')
  const mcpIds = ids('mcp-server')
  const toolIds = ids('custom-tool')
  const skillIds = ids('skill')
  // Files are identified by storage key (not `workspace_files.id`); a copied file's mapping
  // target is its child storage key, so existence is checked by key in the target workspace.
  const fileKeys = ids('file')

  const [creds, tables, kbs, docs, servers, tools, skills, files] = await Promise.all([
    credIds.length === 0
      ? Promise.resolve([] as Array<{ id: string }>)
      : executor
          .select({ id: credential.id })
          .from(credential)
          .where(
            and(
              eq(credential.workspaceId, workspaceId),
              inArray(credential.type, ['oauth', 'service_account']),
              inArray(credential.id, credIds)
            )
          ),
    tableIds.length === 0
      ? Promise.resolve([] as Array<{ id: string }>)
      : tableCandidatesQuery(executor, workspaceId, tableIds),
    kbIds.length === 0
      ? Promise.resolve([] as Array<{ id: string }>)
      : knowledgeBaseCandidatesQuery(executor, workspaceId, kbIds),
    // Documents are validated through a KB join (they are not a standalone candidate kind), so
    // this existence check stays inline rather than sharing a per-kind candidate query.
    docIds.length === 0
      ? Promise.resolve([] as Array<{ id: string }>)
      : executor
          .select({ id: document.id })
          .from(document)
          .innerJoin(knowledgeBase, eq(document.knowledgeBaseId, knowledgeBase.id))
          .where(
            and(
              eq(knowledgeBase.workspaceId, workspaceId),
              isNull(knowledgeBase.deletedAt),
              isNull(document.deletedAt),
              isNull(document.archivedAt),
              inArray(document.id, docIds)
            )
          ),
    mcpIds.length === 0
      ? Promise.resolve([] as Array<{ id: string }>)
      : mcpServerCandidatesQuery(executor, workspaceId, mcpIds),
    toolIds.length === 0
      ? Promise.resolve([] as Array<{ id: string }>)
      : customToolCandidatesQuery(executor, workspaceId, toolIds),
    skillIds.length === 0
      ? Promise.resolve([] as Array<{ id: string }>)
      : skillCandidatesQuery(executor, workspaceId, skillIds),
    fileKeys.length === 0
      ? Promise.resolve([] as Array<{ id: string }>)
      : fileCandidatesQuery(executor, workspaceId, fileKeys),
  ])

  const result: Partial<Record<ForkRemapKind, Set<string>>> = {}
  if (credIds.length > 0) result.credential = new Set(creds.map((r) => r.id))
  if (tableIds.length > 0) result.table = new Set(tables.map((r) => r.id))
  if (kbIds.length > 0) result['knowledge-base'] = new Set(kbs.map((r) => r.id))
  if (docIds.length > 0) result['knowledge-document'] = new Set(docs.map((r) => r.id))
  if (mcpIds.length > 0) result['mcp-server'] = new Set(servers.map((r) => r.id))
  if (toolIds.length > 0) result['custom-tool'] = new Set(tools.map((r) => r.id))
  if (skillIds.length > 0) result.skill = new Set(skills.map((r) => r.id))
  // `fileCandidatesQuery` exposes the storage key under `id`, so file existence keys by `r.id`.
  if (fileKeys.length > 0) result.file = new Set(files.map((r) => r.id))
  return result
}

/**
 * Identity metadata (`name`/`url`) for the given MCP server ids in a workspace, looked up by
 * exact id (no candidate cap, same deleted filter as the candidates). Promote uses it for the
 * MAPPED TARGET servers so remapped tool-input entries rewrite their embedded server metadata
 * from the target row (see {@link ForkMcpServerMeta}) - one bounded `inArray` read per sync,
 * never per-entry. An id absent from the map no longer exists; its entries are left as-is.
 */
export async function getMcpServerMetaByIds(
  executor: DbOrTx,
  workspaceId: string,
  ids: string[]
): Promise<Map<string, ForkMcpServerMeta>> {
  if (ids.length === 0) return new Map()
  const rows = await executor
    .select({ id: mcpServers.id, name: mcpServers.name, url: mcpServers.url })
    .from(mcpServers)
    .where(
      and(
        eq(mcpServers.workspaceId, workspaceId),
        isNull(mcpServers.deletedAt),
        inArray(mcpServers.id, ids)
      )
    )
  return new Map(rows.map((row) => [row.id, { name: row.name, url: row.url ?? null }]))
}

/**
 * Provider id for each given credential id in a workspace, looked up by exact id (no
 * candidate cap). Presence in the returned map means the credential exists in the
 * workspace, so this doubles as a cap-free existence + provider check for validation.
 */
export async function getCredentialProvidersByIds(
  executor: DbOrTx,
  workspaceId: string,
  ids: string[]
): Promise<Map<string, string | null>> {
  if (ids.length === 0) return new Map()
  const rows = await executor
    .select({ id: credential.id, providerId: credential.providerId })
    .from(credential)
    .where(
      and(
        eq(credential.workspaceId, workspaceId),
        inArray(credential.type, ['oauth', 'service_account']),
        inArray(credential.id, ids)
      )
    )
  return new Map(rows.map((row) => [row.id, row.providerId ?? null]))
}

/** A copyable workspace file plus its folder grouping (null folder = workspace root). */
export interface ForkCopyableFileResource extends ForkResourceCandidate {
  folderId: string | null
  folderName: string | null
}

export interface ForkCopyableResources {
  files: ForkCopyableFileResource[]
  tables: ForkResourceCandidate[]
  knowledgeBases: ForkResourceCandidate[]
  customTools: ForkResourceCandidate[]
  skills: ForkResourceCandidate[]
  /** External MCP servers, copied as config rows (OAuth tokens never copied - re-auth in child). */
  mcpServers: ForkResourceCandidate[]
  /** Workflow-publishing MCP servers, copied as config-only shells with no workflows attached. */
  workflowMcpServers: ForkResourceCandidate[]
  /**
   * Count of deployed workflows that the fork would copy. When 0, the fork modal shows an
   * informational note (forking is never blocked) - create-fork seeds a blank starter
   * workflow so the child is still a usable workspace.
   */
  deployedWorkflowCount: number
}

/**
 * List the resources in a workspace that can be selected for copy at fork time
 * (the content kinds — never credentials or env vars). Powers the fork modal's
 * resource picker.
 */
export async function listForkCopyableResources(
  executor: DbOrTx,
  workspaceId: string
): Promise<ForkCopyableResources> {
  const [files, tables, kbs, tools, skills, externalServers, servers, deployed] = await Promise.all(
    [
      fileCandidatesWithFolderQuery(executor, workspaceId),
      tableCandidatesQuery(executor, workspaceId),
      knowledgeBaseCandidatesQuery(executor, workspaceId),
      customToolCandidatesQuery(executor, workspaceId),
      skillCandidatesQuery(executor, workspaceId),
      // External MCP servers copy as config rows (same filter as the mapping candidates).
      mcpServerCandidatesQuery(executor, workspaceId),
      executor
        .select({ id: workflowMcpServer.id, label: workflowMcpServer.name })
        .from(workflowMcpServer)
        .where(
          and(eq(workflowMcpServer.workspaceId, workspaceId), isNull(workflowMcpServer.deletedAt))
        )
        .limit(CANDIDATE_LIMIT),
      executor
        .select({ value: count() })
        .from(workflow)
        // Match listDeployedWorkflows: a workflow only counts as copyable when it has an
        // actually-active deployment version, not just the isDeployed flag, so the fork
        // modal's preflight count never over-reports "ghost" deployed workflows.
        .where(
          and(
            eq(workflow.workspaceId, workspaceId),
            eq(workflow.isDeployed, true),
            isNull(workflow.archivedAt),
            exists(
              executor
                .select({ one: sql`1` })
                .from(workflowDeploymentVersion)
                .where(
                  and(
                    eq(workflowDeploymentVersion.workflowId, workflow.id),
                    eq(workflowDeploymentVersion.isActive, true)
                  )
                )
            )
          )
        ),
    ]
  )
  return {
    // The shared folder query also selects the storage key (for the label lookup); the copy
    // picker addresses files by `workspace_files.id`, so drop the key here.
    files: files.map((row) => ({
      id: row.id,
      label: row.label,
      folderId: row.folderId,
      folderName: row.folderName,
    })),
    tables,
    knowledgeBases: kbs,
    customTools: tools,
    skills,
    mcpServers: externalServers,
    workflowMcpServers: servers,
    deployedWorkflowCount: deployed[0]?.value ?? 0,
  }
}

/**
 * A copyable reference's display label plus its folder grouping. `parentId`/`parentLabel` are
 * populated only for files (their folder id + name; null at the workspace root) and are null for
 * every other copyable kind, which the picker renders flat.
 */
export interface ForkCopyableLabel {
  label: string
  parentId: string | null
  parentLabel: string | null
}

/**
 * One copyable resource in the sync SOURCE workspace, keyed the way the promote copy addresses
 * it: files by STORAGE KEY (matching `file-upload` references + `planForkFileCopies`), every
 * other kind by row id. `parentId`/`parentLabel` carry a file's folder grouping (null for
 * non-file kinds and root files).
 */
export interface ForkCopyableSourceResource {
  kind: ForkCopyableKind
  sourceId: string
  label: string
  parentId: string | null
  parentLabel: string | null
}

/**
 * Every copyable-kind resource in the sync source workspace (same archived/deleted filters and
 * per-kind {@link CANDIDATE_LIMIT} cap as the copy picker), as sync-copy candidate entries. The
 * promote plan filters these down to the UNREFERENCED-and-unmapped set it offers for copy
 * alongside the referenced candidates. Covers exactly the sync-copyable kinds
 * (`forkCopyableKindSchema`): workflow-publishing MCP servers are fork-copy-only shells, and
 * credentials / env vars are never copied.
 */
export async function listForkCopyableSourceResources(
  executor: DbOrTx,
  sourceWorkspaceId: string
): Promise<ForkCopyableSourceResource[]> {
  const [files, tables, kbs, tools, skills, mcp] = await Promise.all([
    fileCandidatesWithFolderQuery(executor, sourceWorkspaceId),
    tableCandidatesQuery(executor, sourceWorkspaceId),
    knowledgeBaseCandidatesQuery(executor, sourceWorkspaceId),
    customToolCandidatesQuery(executor, sourceWorkspaceId),
    skillCandidatesQuery(executor, sourceWorkspaceId),
    mcpServerCandidatesQuery(executor, sourceWorkspaceId),
  ])
  const flat = (
    kind: ForkCopyableKind,
    rows: Array<{ id: string; label: string }>
  ): ForkCopyableSourceResource[] =>
    rows.map((row) => ({
      kind,
      sourceId: row.id,
      label: row.label,
      parentId: null,
      parentLabel: null,
    }))
  return [
    ...files.map((row) => ({
      kind: 'file' as const,
      sourceId: row.key,
      label: row.label,
      parentId: row.folderId,
      parentLabel: row.folderName,
    })),
    ...flat('table', tables),
    ...flat('knowledge-base', kbs),
    ...flat('custom-tool', tools),
    ...flat('skill', skills),
    ...flat('mcp-server', mcp),
  ]
}

/**
 * Labels (by exact id) for the copyable resource kinds referenced-but-unmapped at promote time,
 * scoped to the source workspace and the same archived/deleted filters as the copy picker. A
 * resource absent from the result no longer exists in the source, so it can't be copied and is
 * dropped from the sync copy candidates. Keyed `${kind}:${id}` so callers can look a reference up
 * directly; file entries additionally carry their folder grouping. Only kinds with ids are queried.
 */
export async function loadForkCopyableResourceLabels(
  executor: DbOrTx,
  sourceWorkspaceId: string,
  idsByKind: Partial<Record<ForkCopyableKind, string[]>>
): Promise<Map<string, ForkCopyableLabel>> {
  const labels = new Map<string, ForkCopyableLabel>()
  const ids = (kind: ForkCopyableKind): string[] => {
    const list = idsByKind[kind]
    return list && list.length > 0 ? list : []
  }
  const kbIds = ids('knowledge-base')
  const tableIds = ids('table')
  const toolIds = ids('custom-tool')
  const skillIds = ids('skill')
  const mcpIds = ids('mcp-server')
  // Files are keyed by storage key (not `workspace_files.id`), so they label by key.
  const fileKeys = ids('file')

  const [kbs, tables, tools, skills, mcp, files] = await Promise.all([
    kbIds.length === 0
      ? Promise.resolve([] as Array<{ id: string; label: string }>)
      : knowledgeBaseCandidatesQuery(executor, sourceWorkspaceId, kbIds),
    tableIds.length === 0
      ? Promise.resolve([] as Array<{ id: string; label: string }>)
      : tableCandidatesQuery(executor, sourceWorkspaceId, tableIds),
    toolIds.length === 0
      ? Promise.resolve([] as Array<{ id: string; label: string }>)
      : customToolCandidatesQuery(executor, sourceWorkspaceId, toolIds),
    skillIds.length === 0
      ? Promise.resolve([] as Array<{ id: string; label: string }>)
      : skillCandidatesQuery(executor, sourceWorkspaceId, skillIds),
    mcpIds.length === 0
      ? Promise.resolve([] as Array<{ id: string; label: string }>)
      : mcpServerCandidatesQuery(executor, sourceWorkspaceId, mcpIds),
    fileKeys.length === 0
      ? Promise.resolve(
          [] as Array<{
            key: string
            label: string
            folderId: string | null
            folderName: string | null
          }>
        )
      : fileCandidatesWithFolderQuery(executor, sourceWorkspaceId, { keys: fileKeys }),
  ])

  const flat = (label: string): ForkCopyableLabel => ({ label, parentId: null, parentLabel: null })
  for (const row of kbs) labels.set(`knowledge-base:${row.id}`, flat(row.label))
  for (const row of tables) labels.set(`table:${row.id}`, flat(row.label))
  for (const row of tools) labels.set(`custom-tool:${row.id}`, flat(row.label))
  for (const row of skills) labels.set(`skill:${row.id}`, flat(row.label))
  for (const row of mcp) labels.set(`mcp-server:${row.id}`, flat(row.label))
  for (const row of files) {
    labels.set(`file:${row.key}`, {
      label: row.label,
      parentId: row.folderId,
      parentLabel: row.folderName,
    })
  }
  return labels
}

/** Resolve a credential id to its stored mapping resource type. */
export async function classifyCredentialResourceType(
  executor: DbOrTx,
  credentialId: string,
  workspaceId: string
): Promise<Extract<ForkResourceType, 'oauth_credential' | 'service_account_credential'>> {
  const [row] = await executor
    .select({ type: credential.type })
    .from(credential)
    .where(and(eq(credential.id, credentialId), eq(credential.workspaceId, workspaceId)))
    .limit(1)
  return row?.type === 'service_account' ? 'service_account_credential' : 'oauth_credential'
}
