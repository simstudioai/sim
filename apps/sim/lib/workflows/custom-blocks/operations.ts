import { db } from '@sim/db'
import {
  customBlock,
  workflow,
  workflowBlocks,
  workflowDeploymentVersion,
  workspace,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId, generateShortId } from '@sim/utils/id'
import { and, eq, isNull, ne, sql } from 'drizzle-orm'
import { isOrganizationFeatureEntitled } from '@/lib/billing/core/subscription'
import { acquireOrganizationMutationLock } from '@/lib/billing/organizations/membership'
import { isBillingEnabled, isCustomBlocksEnabled } from '@/lib/core/config/env-flags'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import type { DbOrTx } from '@/lib/db/types'
import { extractInputFieldsFromBlocks, type WorkflowInputField } from '@/lib/workflows/input-format'
import { loadDeployedWorkflowState } from '@/lib/workflows/persistence/utils'
import { getWorkspaceWithOwner } from '@/lib/workspaces/permissions/utils'
import type { CustomBlockOutput, CustomBlockRow } from '@/blocks/custom/build-config'
import { CUSTOM_BLOCK_TYPE_PREFIX, isReservedOutputName } from '@/blocks/custom/build-config'

const logger = createLogger('CustomBlocksOperations')
const CUSTOM_BLOCK_HYDRATION_CONCURRENCY = 10

/** Whether the deployment permits Custom Blocks surfaces independent of an organization's plan. */
export function isCustomBlocksDeploymentEnabled(): boolean {
  return isBillingEnabled || isCustomBlocksEnabled
}

/** Whether an organization may publish, list, and execute custom blocks. */
export async function isCustomBlocksEligibleForOrganization(
  organizationId: string
): Promise<boolean> {
  return isOrganizationFeatureEntitled(organizationId, isCustomBlocksEnabled)
}

/**
 * Resolve a workspace's organization only when it is eligible for custom blocks.
 * Applying the shared entitlement in every org-scoped resolver keeps execution,
 * the Copilot VFS, and workspace context from surfacing blocks the API withholds.
 * Returns `null` when ineligible.
 */
async function eligibleOrgForWorkspace(workspaceId: string): Promise<string | null> {
  const ws = await getWorkspaceWithOwner(workspaceId, { includeArchived: true })
  if (!ws?.organizationId) return null
  if (!(await isCustomBlocksEligibleForOrganization(ws.organizationId))) return null
  return ws.organizationId
}

/**
 * Whether the workspace's organization may use custom blocks. Feeds the
 * `custom-blocks` entitlement in
 * `@/lib/copilot/entitlements` and matches the REST route gates.
 */
export async function isCustomBlocksEligible(workspaceId: string): Promise<boolean> {
  return (await eligibleOrgForWorkspace(workspaceId)) !== null
}

/** A persisted custom block plus its live-derived Start input fields. */
export interface CustomBlockWithInputs {
  id: string
  organizationId: string
  workflowId: string
  workflowName: string
  /** Source workflow's home workspace id — used client-side to gate manage affordances. */
  workspaceId: string | null
  workspaceName: string | null
  type: string
  name: string
  description: string
  iconUrl: string | null
  enabled: boolean
  /** Publisher's org-wide decision on joining this block's runs into consumer traces. */
  traceChildRuns: boolean
  inputFields: WorkflowInputField[]
  exposedOutputs: CustomBlockOutput[]
}

/**
 * Derive a bound workflow's Start input fields from its LATEST DEPLOYMENT — the
 * exact state execution runs. Deriving from the draft/editor tables would let the
 * block advertise inputs the deployed child doesn't accept (or miss ones it still
 * expects) whenever the publisher edits after deploying. Returns `[]` if the
 * workflow has no active deployment.
 */
async function deriveInputFields(
  workflowId: string,
  workspaceId?: string
): Promise<WorkflowInputField[]> {
  try {
    const deployed = await loadDeployedWorkflowState(workflowId, workspaceId)
    return extractInputFieldsFromBlocks(deployed.blocks)
  } catch {
    return []
  }
}

/** A stored per-input override (placeholder + required), keyed by the Start field's stable id. */
type InputPlaceholder = { id: string; placeholder?: string; required?: boolean }

/**
 * The block's input fields: the LIVE deployed Start fields (authoritative for which
 * inputs exist and their name/type — so an input removed from the source and
 * redeployed simply disappears) with the stored per-id `placeholder`/`required`
 * overrides merged in. When the source is undeployed there are no live fields, so
 * there are no inputs — the block can't run undeployed anyway.
 */
function applyInputPlaceholders(
  placeholders: InputPlaceholder[] | null,
  deployed: WorkflowInputField[]
): WorkflowInputField[] {
  if (deployed.length === 0) return []
  if (!placeholders?.length) return deployed
  const byId = new Map(placeholders.map((p) => [p.id, p]))
  // Overrides are stored under `field.id ?? field.name` (the form's key), so a
  // legacy field with no stable id is keyed by name — look it up the same way.
  return deployed.map((field) => {
    const override = byId.get(field.id ?? field.name)
    if (!override) return field
    return {
      ...field,
      ...(override.placeholder ? { placeholder: override.placeholder } : {}),
      ...(override.required ? { required: true } : {}),
    }
  })
}

/**
 * The org's custom blocks for the server overlay (`withCustomBlockOverlay`).
 * Includes DISABLED rows (carrying `enabled`) so a still-placed disabled block
 * stays resolvable — it survives serialization and fails loudly at run via
 * `getCustomBlockAuthority` instead of being silently dropped from the graph; the
 * overlay marks it `hideFromToolbar` so no new instance can be placed. No input
 * fields: the server's `inputMapping` is schema-agnostic and the handler's remap
 * filters every value against the child's live deployed Start.
 */
export async function getCustomBlockRowsForOrg(
  organizationId: string
): Promise<Array<CustomBlockRow & { enabled: boolean }>> {
  const rows = await db
    .select({
      type: customBlock.type,
      name: customBlock.name,
      description: customBlock.description,
      workflowId: customBlock.workflowId,
      outputs: customBlock.outputs,
      enabled: customBlock.enabled,
    })
    .from(customBlock)
    .where(eq(customBlock.organizationId, organizationId))

  return rows.map(({ outputs, ...r }) => ({ ...r, exposedOutputs: outputs ?? [] }))
}

/**
 * The custom-block rows in scope for a workspace's organization, for wrapping an
 * execution in `withCustomBlockOverlay`. Returns `[]` when the workspace has no
 * organization (nothing to resolve).
 */
export async function getCustomBlockRowsForWorkspace(
  workspaceId: string
): Promise<CustomBlockRow[]> {
  const organizationId = await eligibleOrgForWorkspace(workspaceId)
  if (!organizationId) return []
  return getCustomBlockRowsForOrg(organizationId)
}

/**
 * The custom blocks (with live-derived input fields) for a workspace's org. Used
 * by the copilot VFS to expose custom blocks to the agent. Returns `[]` when the
 * workspace has no organization.
 */
export async function listCustomBlocksWithInputsForWorkspace(
  workspaceId: string
): Promise<CustomBlockWithInputs[]> {
  const organizationId = await eligibleOrgForWorkspace(workspaceId)
  if (!organizationId) return []
  return listCustomBlocksWithInputs(organizationId)
}

/**
 * Lightweight enabled-custom-block summaries for a workspace's org (type + name +
 * description, no input derivation). Used by the copilot workspace-context markdown.
 */
export async function listCustomBlockSummariesForWorkspace(
  workspaceId: string
): Promise<Array<{ type: string; name: string; description: string }>> {
  const organizationId = await eligibleOrgForWorkspace(workspaceId)
  if (!organizationId) return []
  return db
    .select({
      type: customBlock.type,
      name: customBlock.name,
      description: customBlock.description,
    })
    .from(customBlock)
    .where(and(eq(customBlock.organizationId, organizationId), eq(customBlock.enabled, true)))
}

/**
 * Hydrate a joined custom-block row into the wire shape. Field set derived live
 * from the deployed Start; stored placeholders merged in. Derive even for a
 * disabled block — the source workflow's deployment is independent of the block's
 * enabled flag, and the edit form needs the real fields so a save doesn't
 * overwrite the block's stored placeholders.
 */
async function hydrateCustomBlockRow(joined: {
  block: typeof customBlock.$inferSelect
  workflowName: string
  workspaceId: string | null
  workspaceName: string | null
}): Promise<CustomBlockWithInputs> {
  const { block: row, workflowName, workspaceId, workspaceName } = joined
  return {
    id: row.id,
    organizationId: row.organizationId,
    workflowId: row.workflowId,
    workflowName,
    workspaceId,
    workspaceName,
    type: row.type,
    name: row.name,
    description: row.description,
    iconUrl: row.iconUrl,
    enabled: row.enabled,
    traceChildRuns: row.traceChildRuns,
    inputFields: applyInputPlaceholders(
      row.inputs,
      await deriveInputFields(row.workflowId, workspaceId ?? undefined)
    ),
    exposedOutputs: row.outputs ?? [],
  }
}

/** The org's custom blocks with live-derived input fields (client overlay + list API). */
export async function listCustomBlocksWithInputs(
  organizationId: string
): Promise<CustomBlockWithInputs[]> {
  const rows = await db
    .select({
      block: customBlock,
      workflowName: workflow.name,
      workspaceId: workflow.workspaceId,
      workspaceName: workspace.name,
    })
    .from(customBlock)
    .innerJoin(workflow, eq(workflow.id, customBlock.workflowId))
    .leftJoin(workspace, eq(workspace.id, workflow.workspaceId))
    .where(eq(customBlock.organizationId, organizationId))

  return mapWithConcurrency(rows, CUSTOM_BLOCK_HYDRATION_CONCURRENCY, hydrateCustomBlockRow)
}

/**
 * The custom block bound to a workflow (with live-derived input fields), or `null`
 * when the workflow isn't published as a block. One block per workflow is enforced
 * at publish time. Used by the copilot publish_custom_block tool.
 */
export async function getCustomBlockWithInputsByWorkflowId(
  workflowId: string
): Promise<CustomBlockWithInputs | null> {
  const [row] = await db
    .select({
      block: customBlock,
      workflowName: workflow.name,
      workspaceId: workflow.workspaceId,
      workspaceName: workspace.name,
    })
    .from(customBlock)
    .innerJoin(workflow, eq(workflow.id, customBlock.workflowId))
    .leftJoin(workspace, eq(workspace.id, workflow.workspaceId))
    .where(eq(customBlock.workflowId, workflowId))
    .limit(1)
  return row ? hydrateCustomBlockRow(row) : null
}

/**
 * Org + source-workspace context for manage (edit/delete) authorization. Managing
 * a block is gated on admin of its SOURCE workflow's workspace — the same workspace
 * publishing required — so only an admin of the workspace that owns the workflow
 * (or an org admin, who holds admin on every org workspace) can change its outputs.
 * `null` when no block matches.
 */
export async function getCustomBlockManageContext(id: string): Promise<{
  organizationId: string
  sourceWorkspaceId: string | null
  type: string
  name: string
} | null> {
  const [row] = await db
    .select({
      organizationId: customBlock.organizationId,
      sourceWorkspaceId: workflow.workspaceId,
      type: customBlock.type,
      name: customBlock.name,
    })
    .from(customBlock)
    .innerJoin(workflow, eq(workflow.id, customBlock.workflowId))
    .where(eq(customBlock.id, id))
    .limit(1)
  return row ?? null
}

/**
 * Execution authority for a custom block, resolved by its block type. Used by the
 * executor to run the bound workflow under the invocation-boundary model: the
 * consumer needs no permission on the source workflow. Returns the authoritative
 * `workflowId` from the DB (never trust a serialized value) plus the source
 * workflow's **owner** (`workflow.userId`). Using the owner (not the publisher)
 * means the owner always has read on their own workflow, and owner deletion
 * cascade-deletes the workflow → the custom_block row, so there is never an
 * orphaned block. `null` when no enabled block matches the type.
 *
 * `ownerUserId` carries further than the owner does on any other trigger. It is
 * the child run's actor, the personal-variable identity, and the subject of its
 * delegated tool calls, because a custom block publishes a fixed behavior to
 * consumers who can see none of its internals and the publisher's own
 * integrations and personal keys are part of that behavior.
 *
 * It is NOT the identity for the two things a workspace owns. Workspace
 * variables authorize against the source workspace's billing account, and that
 * account is the payer, exactly as they would for a schedule on the same
 * workflow — see the environment resolution in `workflow-handler`. Reading those
 * as the owner too gave a published block a narrower workspace-secret selection
 * than the workflow got on every other trigger, which no consumer could see.
 */
export async function getCustomBlockAuthority(
  type: string,
  consumerWorkspaceId: string | undefined
): Promise<{
  workflowId: string
  organizationId: string
  ownerUserId: string
  exposedOutputs: CustomBlockOutput[]
  /** Start-field ids (form keys) the publisher marked required. May reference removed fields. */
  requiredInputIds: string[]
  /**
   * Whether this invocation may publish its child run to the caller's trace. The
   * publisher's decision is the whole policy, and it is resolved HERE so both the
   * canvas handler and the Agent-tool runner — which reach execution through this
   * same lookup — read one value that no consumer input can influence.
   */
  traceChildRuns: boolean
  workflowName: string
  workspaceId: string | null
  variables: unknown
  deploymentVersionId: string | null
} | null> {
  // Scope resolution to the consumer's org: `(organizationId, type)` is the unique
  // key, so without the org filter a `custom_block_*` type smuggled in from another
  // org's serialized workflow could resolve and run that org's block.
  if (!consumerWorkspaceId) return null
  const organizationId = await eligibleOrgForWorkspace(consumerWorkspaceId)
  if (!organizationId) return null

  const [row] = await db
    .select({
      workflowId: customBlock.workflowId,
      organizationId: customBlock.organizationId,
      enabled: customBlock.enabled,
      outputs: customBlock.outputs,
      inputs: customBlock.inputs,
      traceChildRuns: customBlock.traceChildRuns,
      ownerUserId: workflow.userId,
      workflowName: workflow.name,
      workspaceId: workflow.workspaceId,
      variables: workflow.variables,
      deploymentVersionId: workflowDeploymentVersion.id,
    })
    .from(customBlock)
    .innerJoin(workflow, eq(workflow.id, customBlock.workflowId))
    .leftJoin(
      workflowDeploymentVersion,
      and(
        eq(workflowDeploymentVersion.workflowId, workflow.id),
        eq(workflowDeploymentVersion.isActive, true)
      )
    )
    .where(and(eq(customBlock.type, type), eq(customBlock.organizationId, organizationId)))
    .limit(1)

  if (!row || !row.enabled) return null
  return {
    workflowId: row.workflowId,
    organizationId: row.organizationId,
    ownerUserId: row.ownerUserId,
    exposedOutputs: row.outputs ?? [],
    requiredInputIds: (row.inputs ?? []).filter((i) => i.required).map((i) => i.id),
    traceChildRuns: row.traceChildRuns,
    workflowName: row.workflowName,
    workspaceId: row.workspaceId,
    variables: row.variables,
    deploymentVersionId: row.deploymentVersionId,
  }
}

/** A custom block's agent-tool binding: bound workflow + its input schema surface. */
export interface CustomBlockToolBinding {
  workflowId: string
  /** LATEST-deployment Start input fields — the exact inputs the child will accept. */
  inputFields: WorkflowInputField[]
  /** Field ids (form keys) the publisher marked required. */
  requiredInputIds: string[]
}

/**
 * Resolve a custom block's agent-tool binding so an Agent can offer it as a tool:
 * the authoritative bound workflow (org-scoped to the consumer's workspace,
 * owner-derived — the same trust model execution uses via `getCustomBlockAuthority`)
 * plus its LATEST-deployment Start input fields and the publisher's required-input
 * ids. Returns `null` when the type doesn't resolve for the consumer's org
 * (foreign-org, disabled, or missing) so the caller simply omits the tool. Fields
 * are keyed by their stable id, matching `assembleCustomBlockInputMapping`.
 */
export async function resolveCustomBlockToolBinding(
  type: string,
  consumerWorkspaceId: string | undefined
): Promise<CustomBlockToolBinding | null> {
  const authority = await getCustomBlockAuthority(type, consumerWorkspaceId)
  if (!authority) return null
  const inputFields = await deriveInputFields(authority.workflowId)
  return {
    workflowId: authority.workflowId,
    inputFields,
    requiredInputIds: authority.requiredInputIds,
  }
}

export class CustomBlockValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CustomBlockValidationError'
  }
}

/**
 * Reject exposed outputs whose name shadows a system output field. Authoritative
 * check: also covers callers that bypass the HTTP contract (copilot handler).
 */
/**
 * Every field a consumer receives must be one the publisher explicitly chose.
 *
 * There is deliberately no "expose the whole result" fallback: the child's
 * terminal block state carries execution metadata that is legitimate INSIDE a
 * workflow but must not cross an invocation boundary — an agent's `toolCalls`
 * (arguments and results), `providerTiming.thinkingContent` and `cost`, or a
 * nested workflow block's name/id/snapshot id. Curation is what makes the
 * boundary's guarantee structural instead of a deny-list someone has to keep
 * current as new block types gain outputs.
 *
 * Authoritative here as well as in the route contract, because the copilot
 * publish handler bypasses the HTTP boundary.
 */
function assertCuratedOutputs(exposedOutputs: CustomBlockOutput[] | undefined): void {
  if (!exposedOutputs || exposedOutputs.length === 0) {
    throw new CustomBlockValidationError('Select at least one output to expose to consumers')
  }
}

function assertNoReservedOutputNames(exposedOutputs: CustomBlockOutput[] | undefined): void {
  const reserved = exposedOutputs?.find((o) => isReservedOutputName(o.name))
  if (reserved) {
    throw new CustomBlockValidationError(
      `"${reserved.name}" is a reserved output name (success, error, cost)`
    )
  }
}

/**
 * Publish a deployed workflow as an org-wide custom block. The source workflow
 * must live in `workspaceId` — the workspace the caller was verified to admin —
 * so a caller cannot publish another workspace's workflow (which then runs under
 * that workspace owner's credentials and returns caller-chosen outputs). Also
 * validates the workspace belongs to `organizationId` and the workflow is
 * deployed, then inserts the row.
 */
export async function publishCustomBlock(params: {
  organizationId: string
  workspaceId: string
  workflowId: string
  userId: string
  name: string
  description: string
  iconUrl?: string
  inputs?: InputPlaceholder[]
  /** Required — see {@link assertCuratedOutputs}. */
  exposedOutputs: CustomBlockOutput[]
  /** Omitted means off — publishing a block never opens its runs to consumers by default. */
  traceChildRuns?: boolean
}): Promise<CustomBlockWithInputs> {
  const {
    organizationId,
    workspaceId,
    workflowId,
    userId,
    name,
    description,
    iconUrl,
    inputs,
    exposedOutputs,
    traceChildRuns = false,
  } = params

  assertNoReservedOutputNames(exposedOutputs)
  assertCuratedOutputs(exposedOutputs)

  const [wf] = await db
    .select({
      id: workflow.id,
      name: workflow.name,
      workspaceId: workflow.workspaceId,
      isDeployed: workflow.isDeployed,
    })
    .from(workflow)
    .where(eq(workflow.id, workflowId))
    .limit(1)

  if (!wf) throw new CustomBlockValidationError('Workflow not found')
  if (!wf.isDeployed) {
    throw new CustomBlockValidationError('Workflow must be deployed before publishing as a block')
  }

  // Authorization boundary: the caller proved admin on `workspaceId` (route), so
  // the source workflow must actually live there. Without this a workspace admin
  // could publish a different workspace's workflow in the same org.
  if (wf.workspaceId !== workspaceId) {
    throw new CustomBlockValidationError('You can only publish a workflow from its own workspace')
  }

  const id = generateId()
  const type = `${CUSTOM_BLOCK_TYPE_PREFIX}${generateShortId(10).toLowerCase()}`
  const now = new Date()

  /**
   * The org-belongs check and the insert run under the organization mutation
   * lock, together, because an admin workspace move holds that same lock while
   * it re-homes a workspace and unpublishes the blocks bound to its workflows.
   * Reading the workspace's organization outside the lock lets a publish that
   * validated against the OLD organization commit after the move's cleanup
   * scan, leaving a source-organization block bound to a workflow that now
   * lives in another tenant — which `getCustomBlockAuthority` would resolve and
   * execute under the wrong owner's credentials and billing.
   */
  const ws = await db.transaction(async (tx) => {
    await acquireOrganizationMutationLock(tx, organizationId)

    const workspaceRow = wf.workspaceId
      ? await getWorkspaceWithOwner(wf.workspaceId, { executor: tx })
      : null
    if (!workspaceRow?.organizationId || workspaceRow.organizationId !== organizationId) {
      throw new CustomBlockValidationError('Workflow does not belong to this organization')
    }

    // One block per workflow: the (org, type) unique index doesn't prevent the same
    // workflow being published under a fresh `custom_block_*` type, so guard here.
    const [existing] = await tx
      .select({ id: customBlock.id })
      .from(customBlock)
      .where(eq(customBlock.workflowId, workflowId))
      .limit(1)
    if (existing) {
      throw new CustomBlockValidationError('This workflow is already published as a block')
    }

    await tx.insert(customBlock).values({
      id,
      organizationId,
      workflowId,
      type,
      name,
      description,
      iconUrl: iconUrl ?? null,
      inputs: inputs ?? [],
      outputs: exposedOutputs ?? [],
      enabled: true,
      traceChildRuns,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    })

    return workspaceRow
  })

  logger.info('Published custom block', { id, type, organizationId, workflowId })

  return {
    id,
    organizationId,
    workflowId,
    workflowName: wf.name,
    workspaceId: wf.workspaceId,
    workspaceName: ws?.name ?? null,
    type,
    name,
    description,
    iconUrl: iconUrl ?? null,
    enabled: true,
    traceChildRuns,
    inputFields: applyInputPlaceholders(
      inputs ?? null,
      await deriveInputFields(workflowId, workspaceId)
    ),
    exposedOutputs: exposedOutputs ?? [],
  }
}

/**
 * Update a custom block's presentation/enabled state. `iconUrl`: a URL
 * sets/replaces the icon, `null` clears it (default icon), `undefined` leaves it
 * unchanged.
 */
export async function updateCustomBlock(
  id: string,
  updates: {
    name?: string
    description?: string
    enabled?: boolean
    iconUrl?: string | null
    inputs?: InputPlaceholder[]
    exposedOutputs?: CustomBlockOutput[]
    traceChildRuns?: boolean
  }
): Promise<void> {
  if (updates.exposedOutputs !== undefined) {
    assertNoReservedOutputNames(updates.exposedOutputs)
    assertCuratedOutputs(updates.exposedOutputs)
  }
  const patch: Partial<typeof customBlock.$inferInsert> = { updatedAt: new Date() }
  if (updates.name !== undefined) patch.name = updates.name
  if (updates.description !== undefined) patch.description = updates.description
  if (updates.enabled !== undefined) patch.enabled = updates.enabled
  if (updates.inputs !== undefined) patch.inputs = updates.inputs
  if (updates.exposedOutputs !== undefined) patch.outputs = updates.exposedOutputs
  if (updates.iconUrl !== undefined) patch.iconUrl = updates.iconUrl
  if (updates.traceChildRuns !== undefined) patch.traceChildRuns = updates.traceChildRuns

  await db.update(customBlock).set(patch).where(eq(customBlock.id, id))
}

/**
 * Unpublish (hard-delete) a custom block.
 *
 * Accepts an executor so a caller that must unpublish atomically with something
 * else can enlist it — the admin workspace move unpublishes blocks in the same
 * transaction that re-homes their bound workflow, keeping a block and its
 * workflow from ever being visible in two different organizations.
 */
export async function deleteCustomBlock(id: string, executor: DbOrTx = db): Promise<void> {
  await executor.delete(customBlock).where(eq(customBlock.id, id))
}

/**
 * How many non-archived workflows in the org place the block, in their live
 * editor state and/or their ACTIVE deployment snapshot. The two are scanned
 * independently — a block removed in the editor can still ship in the active
 * deployment (and vice versa), and the deployed placement is the one that
 * actually runs. The deployment scan pre-filters with a raw-text match on the
 * unique type slug so only near-exact matches pay the jsonb parse.
 */
export async function getCustomBlockUsageCounts(
  organizationId: string,
  blockType: string,
  scope?: { onlyWorkspaceId?: string; excludeWorkspaceId?: string }
): Promise<{ usageCount: number; deployedUsageCount: number }> {
  const orgActiveWorkflow = and(
    eq(workspace.organizationId, organizationId),
    isNull(workflow.archivedAt),
    scope?.onlyWorkspaceId ? eq(workflow.workspaceId, scope.onlyWorkspaceId) : undefined,
    scope?.excludeWorkspaceId ? ne(workflow.workspaceId, scope.excludeWorkspaceId) : undefined
  )
  // Escape LIKE wildcards — the `_`s in `custom_block_<id>` would otherwise match
  // any character and let unrelated states through to the jsonb parse.
  const likePattern = `%${blockType.replace(/[\\%_]/g, '\\$&')}%`

  const [liveRows, deployedRows] = await Promise.all([
    db
      .selectDistinct({ workflowId: workflow.id })
      .from(workflowBlocks)
      .innerJoin(workflow, eq(workflow.id, workflowBlocks.workflowId))
      .innerJoin(workspace, eq(workspace.id, workflow.workspaceId))
      .where(and(eq(workflowBlocks.type, blockType), orgActiveWorkflow)),
    db
      .select({ workflowId: workflow.id })
      .from(workflowDeploymentVersion)
      .innerJoin(workflow, eq(workflow.id, workflowDeploymentVersion.workflowId))
      .innerJoin(workspace, eq(workspace.id, workflow.workspaceId))
      .where(
        and(
          eq(workflowDeploymentVersion.isActive, true),
          eq(workflow.isDeployed, true),
          orgActiveWorkflow,
          sql`${workflowDeploymentVersion.state}::text LIKE ${likePattern} ESCAPE '\\'`,
          sql`EXISTS (
            SELECT 1 FROM jsonb_each((${workflowDeploymentVersion.state})::jsonb -> 'blocks') AS b
            WHERE b.value ->> 'type' = ${blockType}
          )`
        )
      ),
  ])

  const usingWorkflowIds = new Set(liveRows.map((r) => r.workflowId))
  for (const row of deployedRows) usingWorkflowIds.add(row.workflowId)

  return { usageCount: usingWorkflowIds.size, deployedUsageCount: deployedRows.length }
}
