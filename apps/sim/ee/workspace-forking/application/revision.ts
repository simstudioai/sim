import {
  credential,
  customBlock,
  customTools,
  folder,
  knowledgeBase,
  mcpServers,
  permissions,
  skill,
  userTableDefinitions,
  webhook,
  workflow,
  workflowBlocks,
  workflowDeploymentVersion,
  workflowEdges,
  workflowSubflows,
  workspace,
  workspaceEnvironment,
  workspaceFiles,
  workspaceForkBlockMap,
  workspaceForkDependentValue,
  workspaceForkResourceMap,
  workspaceSandbox,
} from '@sim/db/schema'
import { type SQL, sql } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import { acquireFolderMutationLock } from '@/lib/folders/locks'
import {
  WorkspaceOperationConflict,
  workflowOperationFingerprint,
} from '@/lib/workspaces/operations/receipts'
import { ForkError } from '@/ee/workspace-forking/lib/lineage/authz'
import type { ForkEdge } from '@/ee/workspace-forking/lib/lineage/lineage'

export interface ForkRevisionScope {
  sourceWorkspaceId: string
  targetWorkspaceId?: string
  edge?: ForkEdge
}

export interface ForkMutationAdmission {
  workspaceId: string
  requestId: string
  requestHash: string
  previewFingerprint: string
  choices: Record<string, unknown>
}

/** Digests are bounded database aggregates; graph and secret values never enter preview diagnostics. */
export async function loadForkPreviewRevision(
  executor: DbOrTx,
  scope: ForkRevisionScope,
  choices: Record<string, unknown>
) {
  const ids = [
    ...new Set([
      scope.sourceWorkspaceId,
      ...(scope.targetWorkspaceId ? [scope.targetWorkspaceId] : []),
    ]),
  ].sort()
  const values = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `
  )
  const workflowIds = sql`SELECT id FROM ${workflow} WHERE workspace_id IN (${values})`
  const queries: Record<string, SQL> = {
    workspaces: sql`SELECT id, to_jsonb(r) - ARRAY['updated_at'] AS state FROM ${workspace} r WHERE id IN (${values})`,
    workflows: sql`SELECT id, to_jsonb(r) - ARRAY['run_count', 'last_run_at', 'last_synced', 'updated_at'] AS state FROM ${workflow} r WHERE workspace_id IN (${values})`,
    source_deployments: sql`SELECT d.id, to_jsonb(d) AS state FROM ${workflowDeploymentVersion} d JOIN ${workflow} w ON w.id = d.workflow_id WHERE w.workspace_id = ${scope.sourceWorkspaceId} AND d.is_active = true AND w.archived_at IS NULL AND w.fork_sync_excluded = false`,
    target_graph: sql`SELECT 'block:' || b.id AS id, to_jsonb(b) - ARRAY['updated_at', 'created_at'] AS state FROM ${workflowBlocks} b JOIN ${workflow} w ON w.id = b.workflow_id WHERE w.workspace_id = ${scope.targetWorkspaceId ?? scope.sourceWorkspaceId}
      UNION ALL SELECT 'edge:' || e.id, to_jsonb(e) - 'created_at' FROM ${workflowEdges} e JOIN ${workflow} w ON w.id = e.workflow_id WHERE w.workspace_id = ${scope.targetWorkspaceId ?? scope.sourceWorkspaceId}
      UNION ALL SELECT 'subflow:' || s.id, to_jsonb(s) - ARRAY['updated_at', 'created_at'] FROM ${workflowSubflows} s JOIN ${workflow} w ON w.id = s.workflow_id WHERE w.workspace_id = ${scope.targetWorkspaceId ?? scope.sourceWorkspaceId}`,
    triggers: sql`SELECT id, to_jsonb(r) - ARRAY['updated_at', 'last_triggered_at'] AS state FROM ${webhook} r WHERE workflow_id IN (${workflowIds})`,
    membership: sql`SELECT id, to_jsonb(r) AS state FROM ${permissions} r WHERE entity_type = 'workspace' AND entity_id IN (${values})`,
    folders: sql`SELECT id, to_jsonb(r) AS state FROM ${folder} r WHERE workspace_id IN (${values})`,
    tables: sql`SELECT id, to_jsonb(r) AS state FROM ${userTableDefinitions} r WHERE workspace_id IN (${values})`,
    knowledge: sql`SELECT id, to_jsonb(r) AS state FROM ${knowledgeBase} r WHERE workspace_id IN (${values})`,
    tools: sql`SELECT id, to_jsonb(r) AS state FROM ${customTools} r WHERE workspace_id IN (${values})`,
    skills: sql`SELECT id, to_jsonb(r) AS state FROM ${skill} r WHERE workspace_id IN (${values})`,
    servers: sql`SELECT id, to_jsonb(r) - ARRAY['updated_at', 'last_connected_at', 'last_tools_refresh', 'tool_count', 'connection_status', 'last_error'] AS state FROM ${mcpServers} r WHERE workspace_id IN (${values})`,
    files: sql`SELECT id, to_jsonb(r) AS state FROM ${workspaceFiles} r WHERE workspace_id IN (${values})`,
    credentials: sql`SELECT id, to_jsonb(r) - ARRAY['updated_at', 'last_used_at'] AS state FROM ${credential} r WHERE workspace_id IN (${values})`,
    secrets: sql`SELECT id, to_jsonb(r) - 'updated_at' AS state FROM ${workspaceEnvironment} r WHERE workspace_id IN (${values})`,
    sandboxes: sql`SELECT id, to_jsonb(r) AS state FROM ${workspaceSandbox} r WHERE workspace_id IN (${values})`,
    custom_blocks: sql`SELECT b.id, to_jsonb(b) || jsonb_build_object('deployment', d.state) AS state FROM ${customBlock} b JOIN ${workspace} w ON w.organization_id = b.organization_id LEFT JOIN ${workflowDeploymentVersion} d ON d.workflow_id = b.workflow_id AND d.is_active = true WHERE w.id = ${scope.targetWorkspaceId ?? scope.sourceWorkspaceId}`,
  }
  if (scope.edge) {
    queries.mappings = sql`SELECT id, to_jsonb(r) AS state FROM ${workspaceForkResourceMap} r WHERE child_workspace_id = ${scope.edge.childWorkspaceId}`
    queries.block_identities = sql`SELECT id, to_jsonb(r) AS state FROM ${workspaceForkBlockMap} r WHERE child_workspace_id = ${scope.edge.childWorkspaceId}`
    queries.dependent_values = sql`SELECT id, to_jsonb(r) AS state FROM ${workspaceForkDependentValue} r WHERE child_workspace_id = ${scope.edge.childWorkspaceId}`
  }
  const categories: Record<string, string> = {}
  for (const [category, rows] of Object.entries(queries)) {
    const [size] = await executor.execute<{ count: string; bytes: string }>(
      sql`SELECT count(*)::text AS count, coalesce(sum(octet_length(state::text)), 0)::text AS bytes FROM (${rows}) revision_rows`
    )
    if (Number(size.count) > 100000 || Number(size.bytes) > 64 * 1024 * 1024)
      throw new ForkError(`Fork preview ${category} exceeds its row or 64 MiB byte ceiling`, 413)
    const [revision] = await executor.execute<{ digest: string }>(
      sql`SELECT md5(coalesce(string_agg(md5(state::text), '' ORDER BY id), '')) AS digest FROM (${rows}) revision_rows`
    )
    categories[category] = revision.digest
  }
  return {
    categories,
    fingerprint: workflowOperationFingerprint({
      scope: {
        sourceWorkspaceId: scope.sourceWorkspaceId,
        targetWorkspaceId: scope.targetWorkspaceId,
        edge: scope.edge,
      },
      choices,
      categories,
    }),
  }
}

/** Locks normalized graph rows as well as workflow metadata, including realtime-only writes. */
export async function lockForkRevision(tx: DbOrTx, scope: ForkRevisionScope): Promise<void> {
  const workspaceIds = [
    ...new Set([
      scope.sourceWorkspaceId,
      ...(scope.targetWorkspaceId ? [scope.targetWorkspaceId] : []),
    ]),
  ].sort()
  for (const id of workspaceIds) await acquireFolderMutationLock(tx, id, 'workflow')
  const values = sql.join(
    workspaceIds.map((id) => sql`${id}`),
    sql`, `
  )
  await tx.execute(sql`SELECT id FROM ${workspace} WHERE id IN (${values}) ORDER BY id FOR UPDATE`)
  await tx.execute(
    sql`SELECT id FROM ${workflow} WHERE workspace_id IN (${values}) ORDER BY id FOR UPDATE`
  )
  for (const table of [workflowBlocks, workflowEdges, workflowSubflows]) {
    await tx.execute(
      sql`SELECT r.id FROM ${table} r JOIN ${workflow} w ON w.id = r.workflow_id WHERE w.workspace_id IN (${values}) ORDER BY r.id FOR UPDATE OF r`
    )
  }
  await tx.execute(
    sql`SELECT d.id FROM ${workflowDeploymentVersion} d JOIN ${workflow} w ON w.id = d.workflow_id WHERE w.workspace_id IN (${values}) AND d.is_active = true ORDER BY d.id FOR SHARE OF d`
  )
  if (scope.edge) {
    const [edge] = await tx.execute<{ parent: string | null }>(
      sql`SELECT forked_from_workspace_id AS parent FROM ${workspace} WHERE id = ${scope.edge.childWorkspaceId} AND archived_at IS NULL`
    )
    if (edge?.parent !== scope.edge.parentWorkspaceId)
      throw new WorkspaceOperationConflict('Fork lineage changed', {
        applied: false,
        reason: 'stale_preview',
        changed: ['lineage'],
      })
  }
}

export async function assertForkPreviewFresh(
  executor: DbOrTx,
  scope: ForkRevisionScope,
  admission: ForkMutationAdmission
): Promise<void> {
  const revision = await loadForkPreviewRevision(executor, scope, admission.choices)
  if (revision.fingerprint !== admission.previewFingerprint)
    throw new WorkspaceOperationConflict('Fork preview is stale; request a new preview', {
      applied: false,
      requestId: admission.requestId,
      reason: 'stale_preview',
      previewFingerprint: revision.fingerprint,
    })
}

/** Verifies the exact source snapshots materialized before acquiring the apply transaction. */
export async function assertForkSourceVersions(
  tx: DbOrTx,
  sourceWorkspaceId: string,
  expected: ReadonlyMap<string, { id: string; digest: string }>
): Promise<void> {
  const rows = await tx.execute<{ workflowId: string; id: string; digest: string }>(sql`
    SELECT w.id AS "workflowId", d.id, md5(d.state::text) AS digest FROM ${workflow} w
    JOIN ${workflowDeploymentVersion} d ON d.workflow_id = w.id AND d.is_active = true
    WHERE w.workspace_id = ${sourceWorkspaceId} AND w.is_deployed = true
      AND w.archived_at IS NULL AND w.fork_sync_excluded = false
  `)
  if (
    rows.length !== expected.size ||
    rows.some(
      (row) =>
        expected.get(row.workflowId)?.id !== row.id ||
        expected.get(row.workflowId)?.digest !== row.digest
    )
  )
    throw new WorkspaceOperationConflict(
      'Source deployment changed during loading; request a new preview',
      {
        applied: false,
        reason: 'stale_preview',
        changed: ['source_deployments'],
      }
    )
}
