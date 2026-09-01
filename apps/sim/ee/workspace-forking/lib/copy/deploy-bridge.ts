import { db, runOutsideTransactionContext } from '@sim/db'
import { webhook, workflow, workflowDeploymentVersion } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, exists, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import { loadDeployedWorkflowState } from '@/lib/workflows/persistence/utils'
import { ForkError } from '@/ee/workspace-forking/lib/lineage/authz'
import type { Variable, WorkflowState } from '@/stores/workflows/workflow/types'
import { isInternalTriggerProvider, isPollingWebhookProvider } from '@/triggers/constants'

const logger = createLogger('WorkspaceForkDeployBridge')

/**
 * Hard ceiling on how many deployed workflows one fork/promote loads into memory at
 * once (each as a full `WorkflowState`). There is no per-workspace workflow cap in
 * the product, so this is the safety valve: real workspaces hold tens to low
 * hundreds, making this ~5-10x headroom that never blocks legitimate use, it sits
 * below the fork feature's other item caps (resource selection 2000, mapping
 * entries 5000 - both lighter-weight than full states), and it bounds a pathological
 * workspace to a few hundred MB of transient state instead of an unbounded load.
 */
export const MAX_FORK_DEPLOYED_WORKFLOWS = 1000

export interface DeployedWorkflowSummary {
  id: string
  name: string
  description: string | null
  folderId: string | null
  sortOrder: number
  /** Whether the deployed API accepts unauthenticated calls; carried onto sync targets. */
  isPublicApi: boolean
}

/**
 * Workflows in a workspace that are deployed and not archived - the only ones that
 * fork/promote. Requires an actually-active deployment version, not just the
 * `isDeployed` flag: a workflow flagged deployed with no active version (a "ghost"
 * left by an inconsistent state) has nothing to copy, so excluding it here keeps the
 * diff/plan counts aligned with what apply actually writes instead of over-reporting
 * then silently skipping it. Correlated `exists` (not a join) so a workflow is never
 * double-listed if more than one active version row ever exists. Workflows marked
 * `forkSyncExcluded` never participate as a source: this one predicate keeps them
 * out of the diff preview, promote (both directions), fork creation, and the
 * mapping-view reference scan.
 */
export async function listDeployedWorkflows(
  executor: DbOrTx,
  workspaceId: string
): Promise<DeployedWorkflowSummary[]> {
  return executor
    .select({
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      folderId: workflow.folderId,
      sortOrder: workflow.sortOrder,
      isPublicApi: workflow.isPublicApi,
    })
    .from(workflow)
    .where(
      and(
        eq(workflow.workspaceId, workspaceId),
        eq(workflow.isDeployed, true),
        eq(workflow.forkSyncExcluded, false),
        isNull(workflow.archivedAt),
        exists(
          db
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
    )
}

/**
 * The complement of {@link listDeployedWorkflows}'s exclusion predicate: deployed,
 * non-archived workflows the workspace admin marked "Exclude from sync". Only the
 * diff preview reads this, to show which workflows a sync deliberately skips;
 * the promote itself never touches them.
 */
export async function listForkExcludedDeployedWorkflows(
  executor: DbOrTx,
  workspaceId: string
): Promise<Array<{ id: string; name: string }>> {
  return executor
    .select({ id: workflow.id, name: workflow.name })
    .from(workflow)
    .where(
      and(
        eq(workflow.workspaceId, workspaceId),
        eq(workflow.isDeployed, true),
        eq(workflow.forkSyncExcluded, true),
        isNull(workflow.archivedAt),
        exists(
          db
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
    )
}

/** The active deployment version number for a workflow, or null when it has none. */
export async function getActiveDeploymentVersionNumber(
  executor: DbOrTx,
  workflowId: string
): Promise<number | null> {
  const [row] = await executor
    .select({ version: workflowDeploymentVersion.version })
    .from(workflowDeploymentVersion)
    .where(
      and(
        eq(workflowDeploymentVersion.workflowId, workflowId),
        eq(workflowDeploymentVersion.isActive, true)
      )
    )
    .limit(1)
  return row?.version ?? null
}

/**
 * Batched {@link getActiveDeploymentVersionNumber}: the active deployed version per
 * workflow id, so promote's apply phase resolves every prior version in one query
 * instead of N round-trips inside the (locked) transaction. Workflows with no active
 * version are absent from the map.
 */
export async function getActiveDeploymentVersionNumbers(
  executor: DbOrTx,
  workflowIds: string[]
): Promise<Map<string, number>> {
  if (workflowIds.length === 0) return new Map()
  const rows = await executor
    .select({
      workflowId: workflowDeploymentVersion.workflowId,
      version: workflowDeploymentVersion.version,
    })
    .from(workflowDeploymentVersion)
    .where(
      and(
        inArray(workflowDeploymentVersion.workflowId, workflowIds),
        eq(workflowDeploymentVersion.isActive, true)
      )
    )
  return new Map(rows.map((row) => [row.workflowId, row.version]))
}

/**
 * Read a source workspace's deployed workflows and each one's active deployed state
 * on the global pool. Fork/promote callers MUST run this BEFORE opening their
 * transaction: doing these heavy per-workflow reads inside the tx checks out a
 * SECOND pooled connection while the tx holds the first, which can deadlock the
 * pool at saturation (primary pool max is 15). The source is read-only for the
 * operation, so a pre-transaction snapshot is the value that gets force-pushed.
 *
 * Holds every source state in memory at once (bounded by the workspace's deployed
 * workflow count) - the apply step needs each state to write its target inside the
 * single atomic transaction, so it cannot stream them one at a time.
 */
export async function loadSourceDeployedStates(sourceWorkspaceId: string): Promise<{
  deployedWorkflows: DeployedWorkflowSummary[]
  sourceStates: Map<string, WorkflowState>
}> {
  const deployedWorkflows = await listDeployedWorkflows(db, sourceWorkspaceId)
  // Fail fast on the cheap count before loading any heavy state into memory.
  if (deployedWorkflows.length > MAX_FORK_DEPLOYED_WORKFLOWS) {
    throw new ForkError(
      `This workspace has ${deployedWorkflows.length} deployed workflows, which exceeds the fork/sync limit of ${MAX_FORK_DEPLOYED_WORKFLOWS}.`,
      400
    )
  }
  // Read states in bounded-concurrency batches instead of one serial await per workflow:
  // serial cost is O(workflows) round trips (this also runs on the diff preview, refetched
  // while the sync modal is open). The cap keeps concurrent global-pool checkouts well
  // under the pool max even at the workflow ceiling, and this runs BEFORE any transaction.
  const sourceStates = new Map<string, WorkflowState>()
  const READ_CONCURRENCY = 5
  for (let i = 0; i < deployedWorkflows.length; i += READ_CONCURRENCY) {
    const batch = deployedWorkflows.slice(i, i + READ_CONCURRENCY)
    const states = await Promise.all(batch.map((wf) => readDeployedState(wf.id, sourceWorkspaceId)))
    batch.forEach((wf, index) => {
      const state = states[index]
      if (state) sourceStates.set(wf.id, state)
    })
  }
  return { deployedWorkflows, sourceStates }
}

/**
 * Read a workflow's active deployed state as a `WorkflowState`. Returns null ONLY
 * when the workflow genuinely has no active deployment (a legitimate skip); real
 * DB/migration errors propagate so the caller fails loudly instead of silently
 * dropping the workflow from the fork/promote. Block migrations (credential remap
 * to current ids) are applied so copied references reflect current resources.
 */
export async function readDeployedState(
  workflowId: string,
  workspaceId: string
): Promise<WorkflowState | null> {
  // This reads the (unchanged) SOURCE workspace on the global pool. Callers like
  // promote run it inside their transaction, so escape the tx context: the read
  // must not join the promote's transaction (and the tripwire forbids global-pool
  // queries inside a tx). Outside a transaction this is a no-op.
  return runOutsideTransactionContext(async () => {
    const version = await getActiveDeploymentVersionNumber(db, workflowId)
    if (version == null) {
      logger.warn('No active deployment for workflow during fork/promote', { workflowId })
      return null
    }
    const data = await loadDeployedWorkflowState(workflowId, workspaceId)
    return {
      blocks: data.blocks,
      edges: data.edges,
      loops: data.loops,
      parallels: data.parallels,
      variables: (data.variables ?? {}) as Record<string, Variable>,
    }
  })
}

/** A live, path-based webhook on a target block: the URL it serves and the workflow it belongs to. */
export interface ForkTargetWebhook {
  path: string
  workflowId: string
  /**
   * The provider the path is served under. An inbound request is authenticated and parsed as this
   * provider, so a URL is only meaningfully transferable to a trigger of the SAME provider.
   */
  provider: string | null
}

/**
 * The public webhook path each target trigger block currently serves on, keyed by block id.
 *
 * A webhook's path defaults to its block id (`triggerPath || block.id`, see
 * `lib/webhooks/deploy.ts`), so the target's URL has always been a *derivation* of an id the
 * sync itself assigns. Reading the live path lets the copy pin it back into the target block's
 * own `triggerPath`, turning the URL into stored data - the sync then cannot move a URL that
 * external systems (a Slack Request URL, a provider subscription) are already pointing at.
 *
 * Only rows serving a PUBLIC URL are returned. Three families are excluded, because preserving
 * their path would be meaningless and offering it for adoption actively wrong:
 * - shared-app providers (the native Slack trigger) route by `routingKey` with a NULL path;
 * - polling providers ({@link isPollingWebhookProvider}) keep a webhook row as state, but Sim
 *   pulls from the provider - nothing external calls the path;
 * - internal providers ({@link isInternalTriggerProvider}) register a path that the public
 *   trigger route deliberately rejects, so it is not an endpoint either.
 *
 * Scoped to each workflow's ACTIVE deployment version, exactly as inbound delivery resolves a
 * path (`lib/webhooks/processor.ts`). A workflow keeps non-archived webhook rows from previous
 * versions too (`lib/webhooks/deploy.ts` reads "ALL webhooks for this workflow (all versions)"
 * before narrowing to the current one), so an unscoped read would return several rows per block
 * and pick a stale path arbitrarily - pinning a URL nothing is actually serving, which is the
 * precise failure this function exists to prevent.
 */
export async function loadTargetWebhookPathsByBlock(
  executor: DbOrTx,
  targetWorkflowIds: string[]
): Promise<Map<string, ForkTargetWebhook>> {
  if (targetWorkflowIds.length === 0) return new Map()
  const rows = await executor
    .select({
      blockId: webhook.blockId,
      path: webhook.path,
      workflowId: webhook.workflowId,
      provider: webhook.provider,
    })
    .from(webhook)
    .innerJoin(
      workflowDeploymentVersion,
      and(
        eq(workflowDeploymentVersion.workflowId, webhook.workflowId),
        eq(workflowDeploymentVersion.isActive, true),
        eq(workflowDeploymentVersion.id, webhook.deploymentVersionId)
      )
    )
    .where(
      and(
        inArray(webhook.workflowId, targetWorkflowIds),
        isNull(webhook.archivedAt),
        isNotNull(webhook.blockId),
        isNotNull(webhook.path)
      )
    )
  const byBlock = new Map<string, ForkTargetWebhook>()
  for (const row of rows) {
    if (!row.blockId || !row.path) continue
    if (isPollingWebhookProvider(row.provider) || isInternalTriggerProvider(row.provider)) {
      continue
    }
    // One live path-based row per block within a version - `path_deployment_unique` enforces it.
    byBlock.set(row.blockId, {
      path: row.path,
      workflowId: row.workflowId,
      provider: row.provider,
    })
  }
  return byBlock
}
