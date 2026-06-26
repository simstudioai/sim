import {
  credential,
  customTools,
  knowledgeBase,
  mcpServers,
  skill,
  userTableDefinitions,
  workflow,
  workspaceEnvironment,
  workspaceFiles,
} from '@sim/db/schema'
import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import type { ForkResourceType } from '@/lib/workspaces/fork/mapping/mapping-store'
import type { ForkRemapKind } from '@/lib/workspaces/fork/remap/remap-references'

export interface ForkResourceCandidate {
  id: string
  label: string
  providerId?: string
}

const CANDIDATE_LIMIT = 1000

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
    executor
      .select({ id: userTableDefinitions.id, name: userTableDefinitions.name })
      .from(userTableDefinitions)
      .where(
        and(
          eq(userTableDefinitions.workspaceId, workspaceId),
          isNull(userTableDefinitions.archivedAt)
        )
      )
      .limit(CANDIDATE_LIMIT),
    executor
      .select({ id: knowledgeBase.id, name: knowledgeBase.name })
      .from(knowledgeBase)
      .where(and(eq(knowledgeBase.workspaceId, workspaceId), isNull(knowledgeBase.deletedAt)))
      .limit(CANDIDATE_LIMIT),
    executor
      .select({ id: mcpServers.id, name: mcpServers.name })
      .from(mcpServers)
      .where(and(eq(mcpServers.workspaceId, workspaceId), isNull(mcpServers.deletedAt)))
      .limit(CANDIDATE_LIMIT),
    executor
      .select({ id: customTools.id, title: customTools.title })
      .from(customTools)
      .where(eq(customTools.workspaceId, workspaceId))
      .limit(CANDIDATE_LIMIT),
    executor
      .select({ id: skill.id, name: skill.name })
      .from(skill)
      .where(eq(skill.workspaceId, workspaceId))
      .limit(CANDIDATE_LIMIT),
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
    table: tables.map((t) => ({ id: t.id, label: t.name })),
    'knowledge-base': kbs.map((kb) => ({ id: kb.id, label: kb.name })),
    'mcp-server': servers.map((server) => ({ id: server.id, label: server.name })),
    'custom-tool': tools.map((tool) => ({ id: tool.id, label: tool.title })),
    skill: skills.map((s) => ({ id: s.id, label: s.name })),
    'knowledge-document': [],
    file: [],
  }
}

export interface ForkCopyableResources {
  files: ForkResourceCandidate[]
  tables: ForkResourceCandidate[]
  knowledgeBases: ForkResourceCandidate[]
  customTools: ForkResourceCandidate[]
  skills: ForkResourceCandidate[]
  mcpServers: ForkResourceCandidate[]
  /**
   * Count of deployed workflows that the fork would copy. The fork modal disables
   * the action (with a reason) when this is 0 and there are no copyable resources,
   * since the fork would otherwise produce an empty workspace.
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
      .where(and(eq(workspaceFiles.workspaceId, workspaceId), isNull(workspaceFiles.deletedAt)))
      .limit(CANDIDATE_LIMIT),
    executor
      .select({ id: userTableDefinitions.id, label: userTableDefinitions.name })
      .from(userTableDefinitions)
      .where(
        and(
          eq(userTableDefinitions.workspaceId, workspaceId),
          isNull(userTableDefinitions.archivedAt)
        )
      )
      .limit(CANDIDATE_LIMIT),
    executor
      .select({ id: knowledgeBase.id, label: knowledgeBase.name })
      .from(knowledgeBase)
      .where(and(eq(knowledgeBase.workspaceId, workspaceId), isNull(knowledgeBase.deletedAt)))
      .limit(CANDIDATE_LIMIT),
    executor
      .select({ id: customTools.id, label: customTools.title })
      .from(customTools)
      .where(eq(customTools.workspaceId, workspaceId))
      .limit(CANDIDATE_LIMIT),
    executor
      .select({ id: skill.id, label: skill.name })
      .from(skill)
      .where(eq(skill.workspaceId, workspaceId))
      .limit(CANDIDATE_LIMIT),
    executor
      .select({ id: mcpServers.id, label: mcpServers.name })
      .from(mcpServers)
      .where(and(eq(mcpServers.workspaceId, workspaceId), isNull(mcpServers.deletedAt)))
      .limit(CANDIDATE_LIMIT),
    executor
      .select({ value: count() })
      .from(workflow)
      .where(
        and(
          eq(workflow.workspaceId, workspaceId),
          eq(workflow.isDeployed, true),
          isNull(workflow.archivedAt)
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
