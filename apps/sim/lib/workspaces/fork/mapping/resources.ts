import {
  credential,
  customTools,
  knowledgeBase,
  mcpServers,
  skill,
  userTableDefinitions,
  workflow,
  workflowDeploymentVersion,
  workspaceEnvironment,
  workspaceFiles,
} from '@sim/db/schema'
import { and, count, eq, exists, inArray, isNull, sql } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import type { ForkResourceType } from '@/lib/workspaces/fork/mapping/mapping-store'
import type { ForkRemapKind } from '@/lib/workspaces/fork/remap/remap-references'

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
// filters so the two pickers can never drift apart. Credentials, env vars (mapping-only),
// and files (copy-only) stay inline in their respective functions.
const tableCandidatesQuery = (executor: DbOrTx, workspaceId: string) =>
  executor
    .select({ id: userTableDefinitions.id, label: userTableDefinitions.name })
    .from(userTableDefinitions)
    .where(
      and(
        eq(userTableDefinitions.workspaceId, workspaceId),
        isNull(userTableDefinitions.archivedAt)
      )
    )
    .limit(CANDIDATE_LIMIT)

const knowledgeBaseCandidatesQuery = (executor: DbOrTx, workspaceId: string) =>
  executor
    .select({ id: knowledgeBase.id, label: knowledgeBase.name })
    .from(knowledgeBase)
    .where(and(eq(knowledgeBase.workspaceId, workspaceId), isNull(knowledgeBase.deletedAt)))
    .limit(CANDIDATE_LIMIT)

const customToolCandidatesQuery = (executor: DbOrTx, workspaceId: string) =>
  executor
    .select({ id: customTools.id, label: customTools.title })
    .from(customTools)
    .where(eq(customTools.workspaceId, workspaceId))
    .limit(CANDIDATE_LIMIT)

const skillCandidatesQuery = (executor: DbOrTx, workspaceId: string) =>
  executor
    .select({ id: skill.id, label: skill.name })
    .from(skill)
    .where(eq(skill.workspaceId, workspaceId))
    .limit(CANDIDATE_LIMIT)

const mcpServerCandidatesQuery = (executor: DbOrTx, workspaceId: string) =>
  executor
    .select({ id: mcpServers.id, label: mcpServers.name })
    .from(mcpServers)
    .where(and(eq(mcpServers.workspaceId, workspaceId), isNull(mcpServers.deletedAt)))
    .limit(CANDIDATE_LIMIT)

/**
 * List the resources in a workspace that can serve as mapping targets, grouped by
 * remap kind. Used to populate the mapping UI's target pickers and to label the
 * source resources being mapped. `knowledge-document` and `file` are intentionally
 * left empty for v1 (optional kinds resolved manually).
 */
export async function listForkResourceCandidates(
  executor: DbOrTx,
  workspaceId: string
): Promise<Record<ForkRemapKind, ForkResourceCandidate[]>> {
  const [creds, wsEnvRows, tables, kbs, servers, tools, skills] = await Promise.all([
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
    file: [],
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
  const mcpIds = ids('mcp-server')
  const toolIds = ids('custom-tool')
  const skillIds = ids('skill')

  const [creds, tables, kbs, servers, tools, skills] = await Promise.all([
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
      : executor
          .select({ id: userTableDefinitions.id })
          .from(userTableDefinitions)
          .where(
            and(
              eq(userTableDefinitions.workspaceId, workspaceId),
              isNull(userTableDefinitions.archivedAt),
              inArray(userTableDefinitions.id, tableIds)
            )
          ),
    kbIds.length === 0
      ? Promise.resolve([] as Array<{ id: string }>)
      : executor
          .select({ id: knowledgeBase.id })
          .from(knowledgeBase)
          .where(
            and(
              eq(knowledgeBase.workspaceId, workspaceId),
              isNull(knowledgeBase.deletedAt),
              inArray(knowledgeBase.id, kbIds)
            )
          ),
    mcpIds.length === 0
      ? Promise.resolve([] as Array<{ id: string }>)
      : executor
          .select({ id: mcpServers.id })
          .from(mcpServers)
          .where(
            and(
              eq(mcpServers.workspaceId, workspaceId),
              isNull(mcpServers.deletedAt),
              inArray(mcpServers.id, mcpIds)
            )
          ),
    toolIds.length === 0
      ? Promise.resolve([] as Array<{ id: string }>)
      : executor
          .select({ id: customTools.id })
          .from(customTools)
          .where(and(eq(customTools.workspaceId, workspaceId), inArray(customTools.id, toolIds))),
    skillIds.length === 0
      ? Promise.resolve([] as Array<{ id: string }>)
      : executor
          .select({ id: skill.id })
          .from(skill)
          .where(and(eq(skill.workspaceId, workspaceId), inArray(skill.id, skillIds))),
  ])

  const result: Partial<Record<ForkRemapKind, Set<string>>> = {}
  if (credIds.length > 0) result.credential = new Set(creds.map((r) => r.id))
  if (tableIds.length > 0) result.table = new Set(tables.map((r) => r.id))
  if (kbIds.length > 0) result['knowledge-base'] = new Set(kbs.map((r) => r.id))
  if (mcpIds.length > 0) result['mcp-server'] = new Set(servers.map((r) => r.id))
  if (toolIds.length > 0) result['custom-tool'] = new Set(tools.map((r) => r.id))
  if (skillIds.length > 0) result.skill = new Set(skills.map((r) => r.id))
  return result
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

export interface ForkCopyableResources {
  files: ForkResourceCandidate[]
  tables: ForkResourceCandidate[]
  knowledgeBases: ForkResourceCandidate[]
  customTools: ForkResourceCandidate[]
  skills: ForkResourceCandidate[]
  mcpServers: ForkResourceCandidate[]
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
  const [files, tables, kbs, tools, skills, servers, deployed] = await Promise.all([
    executor
      .select({
        id: workspaceFiles.id,
        // displayName is nullable; fall back to the (non-null) original name.
        label: sql<string>`coalesce(${workspaceFiles.displayName}, ${workspaceFiles.originalName})`,
      })
      .from(workspaceFiles)
      // Only durable workspace files are forkable - chat/copilot/mothership uploads are
      // session-scoped attachments (and their chat-bound unique index can't be copied).
      .where(
        and(
          eq(workspaceFiles.workspaceId, workspaceId),
          eq(workspaceFiles.context, 'workspace'),
          isNull(workspaceFiles.deletedAt)
        )
      )
      .limit(CANDIDATE_LIMIT),
    tableCandidatesQuery(executor, workspaceId),
    knowledgeBaseCandidatesQuery(executor, workspaceId),
    customToolCandidatesQuery(executor, workspaceId),
    skillCandidatesQuery(executor, workspaceId),
    mcpServerCandidatesQuery(executor, workspaceId),
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
  ])
  return {
    files,
    tables,
    knowledgeBases: kbs,
    customTools: tools,
    skills,
    mcpServers: servers,
    deployedWorkflowCount: deployed[0]?.value ?? 0,
  }
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
