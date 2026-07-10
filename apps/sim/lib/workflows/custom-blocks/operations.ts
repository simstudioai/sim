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
import { and, eq, isNull, sql } from 'drizzle-orm'
import { isOrganizationOnEnterprisePlan } from '@/lib/billing/core/subscription'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { extractInputFieldsFromBlocks, type WorkflowInputField } from '@/lib/workflows/input-format'
import { loadDeployedWorkflowState } from '@/lib/workflows/persistence/utils'
import { getWorkspaceWithOwner } from '@/lib/workspaces/permissions/utils'
import type { CustomBlockOutput, CustomBlockRow } from '@/blocks/custom/build-config'
import { CUSTOM_BLOCK_TYPE_PREFIX } from '@/blocks/custom/build-config'

const logger = createLogger('CustomBlocksOperations')

/**
 * Resolve a workspace's organization ONLY when custom blocks are enabled for it —
 * the same gate the REST list/publish routes apply (`deploy-as-block` flag +
 * enterprise plan). Applying it in every org-scoped resolver keeps execution, the
 * copilot VFS, and workspace context from surfacing blocks the API withholds (e.g.
 * after an org drops off the enterprise plan). Returns `null` when ineligible.
 */
async function eligibleOrgForWorkspace(workspaceId: string): Promise<string | null> {
  const ws = await getWorkspaceWithOwner(workspaceId, { includeArchived: true })
  if (!ws?.organizationId) return null
  if (!(await isFeatureEnabled('deploy-as-block', { orgId: ws.organizationId }))) return null
  if (!(await isOrganizationOnEnterprisePlan(ws.organizationId))) return null
  return ws.organizationId
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
async function deriveInputFields(workflowId: string): Promise<WorkflowInputField[]> {
  try {
    const deployed = await loadDeployedWorkflowState(workflowId)
    return extractInputFieldsFromBlocks(deployed.blocks)
  } catch {
    return []
  }
}

/** A stored per-input placeholder override, keyed by the Start field's stable id. */
type InputPlaceholder = { id: string; placeholder?: string }

/**
 * The block's input fields: the LIVE deployed Start fields (authoritative for which
 * inputs exist and their name/type — so an input removed from the source and
 * redeployed simply disappears) with the stored per-id `placeholder` overrides
 * merged in. When the source is undeployed there are no live fields, so there are
 * no inputs — the block can't run undeployed anyway.
 */
function applyInputPlaceholders(
  placeholders: InputPlaceholder[] | null,
  deployed: WorkflowInputField[]
): WorkflowInputField[] {
  if (deployed.length === 0) return []
  if (!placeholders?.length) return deployed
  const byId = new Map(placeholders.map((p) => [p.id, p.placeholder]))
  // Placeholders are stored under `field.id ?? field.name` (the form's key), so a
  // legacy field with no stable id is keyed by name — look it up the same way.
  return deployed.map((field) => {
    const placeholder = byId.get(field.id ?? field.name)
    return placeholder ? { ...field, placeholder } : field
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

  return Promise.all(
    rows.map(async ({ block: row, workflowName, workspaceId, workspaceName }) => ({
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
      // Field set derived live from the deployed Start; stored placeholders merged
      // in. Derive even for a disabled block — the source workflow's deployment is
      // independent of the block's enabled flag, and the edit form needs the real
      // fields so a save doesn't overwrite the block's stored placeholders.
      inputFields: applyInputPlaceholders(row.inputs, await deriveInputFields(row.workflowId)),
      exposedOutputs: row.outputs ?? [],
    }))
  )
}

/** Fetch a single custom block row by id. */
export async function getCustomBlockById(id: string) {
  const [row] = await db.select().from(customBlock).where(eq(customBlock.id, id)).limit(1)
  return row ?? null
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
 * workflow's **owner** (`workflow.userId`) — the same identity a normal deployed
 * API/schedule/webhook run executes as. Using the owner (not the publisher) means
 * the owner always has read on their own workflow, and owner deletion cascade-
 * deletes the workflow → the custom_block row, so there is never an orphaned block.
 * `null` when no enabled block matches the type.
 */
export async function getCustomBlockAuthority(
  type: string,
  consumerWorkspaceId: string | undefined
): Promise<{
  workflowId: string
  organizationId: string
  ownerUserId: string
  exposedOutputs: CustomBlockOutput[]
} | null> {
  // Scope resolution to the consumer's org: `(organizationId, type)` is the unique
  // key, so without the org filter a `custom_block_*` type smuggled in from another
  // org's serialized workflow could resolve and run that org's block.
  if (!consumerWorkspaceId) return null
  // Match `getCustomBlockRowsForWorkspace` (which builds the overlay) — include
  // archived so a workspace that can serialize a custom block can also execute it,
  // instead of failing mid-run with "no longer available".
  const consumerWs = await getWorkspaceWithOwner(consumerWorkspaceId, { includeArchived: true })
  if (!consumerWs?.organizationId) return null

  const [row] = await db
    .select({
      workflowId: customBlock.workflowId,
      organizationId: customBlock.organizationId,
      enabled: customBlock.enabled,
      outputs: customBlock.outputs,
      ownerUserId: workflow.userId,
    })
    .from(customBlock)
    .innerJoin(workflow, eq(workflow.id, customBlock.workflowId))
    .where(
      and(eq(customBlock.type, type), eq(customBlock.organizationId, consumerWs.organizationId))
    )
    .limit(1)

  if (!row || !row.enabled) return null
  return {
    workflowId: row.workflowId,
    organizationId: row.organizationId,
    ownerUserId: row.ownerUserId,
    exposedOutputs: row.outputs ?? [],
  }
}

export class CustomBlockValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CustomBlockValidationError'
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
  exposedOutputs?: CustomBlockOutput[]
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
  } = params

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

  const ws = wf.workspaceId ? await getWorkspaceWithOwner(wf.workspaceId) : null
  if (!ws?.organizationId || ws.organizationId !== organizationId) {
    throw new CustomBlockValidationError('Workflow does not belong to this organization')
  }

  // One block per workflow: the (org, type) unique index doesn't prevent the same
  // workflow being published under a fresh `custom_block_*` type, so guard here.
  const [existing] = await db
    .select({ id: customBlock.id })
    .from(customBlock)
    .where(eq(customBlock.workflowId, workflowId))
    .limit(1)
  if (existing) {
    throw new CustomBlockValidationError('This workflow is already published as a block')
  }

  const id = generateId()
  const type = `${CUSTOM_BLOCK_TYPE_PREFIX}${generateShortId(10).toLowerCase()}`
  const now = new Date()

  await db.insert(customBlock).values({
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
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
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
    inputFields: applyInputPlaceholders(inputs ?? null, await deriveInputFields(workflowId)),
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
  }
): Promise<void> {
  const patch: Partial<typeof customBlock.$inferInsert> = { updatedAt: new Date() }
  if (updates.name !== undefined) patch.name = updates.name
  if (updates.description !== undefined) patch.description = updates.description
  if (updates.enabled !== undefined) patch.enabled = updates.enabled
  if (updates.inputs !== undefined) patch.inputs = updates.inputs
  if (updates.exposedOutputs !== undefined) patch.outputs = updates.exposedOutputs
  if (updates.iconUrl !== undefined) patch.iconUrl = updates.iconUrl

  await db.update(customBlock).set(patch).where(eq(customBlock.id, id))
}

/** Unpublish (hard-delete) a custom block. */
export async function deleteCustomBlock(id: string): Promise<void> {
  await db.delete(customBlock).where(eq(customBlock.id, id))
}

/** A workflow in the org that places a custom block. */
export interface CustomBlockUsageRow {
  workflowId: string
  workflowName: string
  workspaceId: string
  workspaceName: string
  isDeployed: boolean
  inLiveState: boolean
  inActiveDeployment: boolean
}

/**
 * Every non-archived workflow in the org that places the block, in its live
 * editor state and/or its ACTIVE deployment snapshot. The two are scanned
 * independently — a block removed in the editor can still ship in the active
 * deployment (and vice versa), and the deployed placement is the one that
 * actually runs. The deployment scan pre-filters with a raw-text match on the
 * unique type slug so only near-exact matches pay the jsonb parse.
 */
export async function getCustomBlockUsages(
  organizationId: string,
  blockType: string
): Promise<CustomBlockUsageRow[]> {
  const meta = {
    workflowId: workflow.id,
    workflowName: workflow.name,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    isDeployed: workflow.isDeployed,
  }
  const orgActiveWorkflow = and(
    eq(workspace.organizationId, organizationId),
    isNull(workflow.archivedAt)
  )

  const [liveRows, deployedRows] = await Promise.all([
    db
      .selectDistinct(meta)
      .from(workflowBlocks)
      .innerJoin(workflow, eq(workflow.id, workflowBlocks.workflowId))
      .innerJoin(workspace, eq(workspace.id, workflow.workspaceId))
      .where(and(eq(workflowBlocks.type, blockType), orgActiveWorkflow)),
    db
      .select(meta)
      .from(workflowDeploymentVersion)
      .innerJoin(workflow, eq(workflow.id, workflowDeploymentVersion.workflowId))
      .innerJoin(workspace, eq(workspace.id, workflow.workspaceId))
      .where(
        and(
          eq(workflowDeploymentVersion.isActive, true),
          eq(workflow.isDeployed, true),
          orgActiveWorkflow,
          sql`${workflowDeploymentVersion.state}::text LIKE ${`%${blockType}%`}`,
          sql`EXISTS (
            SELECT 1 FROM jsonb_each((${workflowDeploymentVersion.state})::jsonb -> 'blocks') AS b
            WHERE b.value ->> 'type' = ${blockType}
          )`
        )
      ),
  ])

  const byWorkflowId = new Map<string, CustomBlockUsageRow>()
  for (const row of liveRows) {
    byWorkflowId.set(row.workflowId, { ...row, inLiveState: true, inActiveDeployment: false })
  }
  for (const row of deployedRows) {
    const existing = byWorkflowId.get(row.workflowId)
    if (existing) existing.inActiveDeployment = true
    else byWorkflowId.set(row.workflowId, { ...row, inLiveState: false, inActiveDeployment: true })
  }

  return [...byWorkflowId.values()].sort(
    (a, b) =>
      a.workspaceName.localeCompare(b.workspaceName) || a.workflowName.localeCompare(b.workflowName)
  )
}
