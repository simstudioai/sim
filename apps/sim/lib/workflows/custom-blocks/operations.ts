import { db } from '@sim/db'
import { customBlock, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId, generateShortId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import { extractInputFieldsFromBlocks, type WorkflowInputField } from '@/lib/workflows/input-format'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import { getWorkspaceWithOwner } from '@/lib/workspaces/permissions/utils'
import type { CustomBlockOutput, CustomBlockRow } from '@/blocks/custom/build-config'
import { CUSTOM_BLOCK_TYPE_PREFIX } from '@/blocks/custom/build-config'

const logger = createLogger('CustomBlocksOperations')

/** A persisted custom block plus its live-derived Start input fields. */
export interface CustomBlockWithInputs {
  id: string
  organizationId: string
  workflowId: string
  type: string
  name: string
  description: string
  iconUrl: string | null
  enabled: boolean
  inputFields: WorkflowInputField[]
  exposedOutputs: CustomBlockOutput[]
}

/** Derive a bound workflow's Start input fields from its current normalized state. */
async function deriveInputFields(workflowId: string): Promise<WorkflowInputField[]> {
  const data = await loadWorkflowFromNormalizedTables(workflowId)
  if (!data) return []
  return extractInputFieldsFromBlocks(data.blocks)
}

/**
 * The org's custom blocks as bare `CustomBlockRow`s for the server overlay
 * (`withCustomBlockOverlay`). Only enabled rows — a disabled block must not
 * resolve for execution. No input fields (the server's `inputMapping` is
 * schema-agnostic).
 */
export async function getCustomBlockRowsForOrg(organizationId: string): Promise<CustomBlockRow[]> {
  const rows = await db
    .select({
      type: customBlock.type,
      name: customBlock.name,
      description: customBlock.description,
      workflowId: customBlock.workflowId,
      outputs: customBlock.outputs,
    })
    .from(customBlock)
    .where(and(eq(customBlock.organizationId, organizationId), eq(customBlock.enabled, true)))

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
  const ws = await getWorkspaceWithOwner(workspaceId, { includeArchived: true })
  if (!ws?.organizationId) return []
  return getCustomBlockRowsForOrg(ws.organizationId)
}

/**
 * The custom blocks (with live-derived input fields) for a workspace's org. Used
 * by the copilot VFS to expose custom blocks to the agent. Returns `[]` when the
 * workspace has no organization.
 */
export async function listCustomBlocksWithInputsForWorkspace(
  workspaceId: string
): Promise<CustomBlockWithInputs[]> {
  const ws = await getWorkspaceWithOwner(workspaceId, { includeArchived: true })
  if (!ws?.organizationId) return []
  return listCustomBlocksWithInputs(ws.organizationId)
}

/**
 * Lightweight enabled-custom-block summaries for a workspace's org (type + name +
 * description, no input derivation). Used by the copilot workspace-context markdown.
 */
export async function listCustomBlockSummariesForWorkspace(
  workspaceId: string
): Promise<Array<{ type: string; name: string; description: string }>> {
  const ws = await getWorkspaceWithOwner(workspaceId, { includeArchived: true })
  if (!ws?.organizationId) return []
  return db
    .select({
      type: customBlock.type,
      name: customBlock.name,
      description: customBlock.description,
    })
    .from(customBlock)
    .where(and(eq(customBlock.organizationId, ws.organizationId), eq(customBlock.enabled, true)))
}

/** The org's custom blocks with live-derived input fields (client overlay + list API). */
export async function listCustomBlocksWithInputs(
  organizationId: string
): Promise<CustomBlockWithInputs[]> {
  const rows = await db
    .select()
    .from(customBlock)
    .where(eq(customBlock.organizationId, organizationId))

  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      organizationId: row.organizationId,
      workflowId: row.workflowId,
      type: row.type,
      name: row.name,
      description: row.description,
      iconUrl: row.iconUrl,
      enabled: row.enabled,
      inputFields: row.enabled ? await deriveInputFields(row.workflowId) : [],
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
export async function getCustomBlockManageContext(
  id: string
): Promise<{ organizationId: string; sourceWorkspaceId: string | null } | null> {
  const [row] = await db
    .select({
      organizationId: customBlock.organizationId,
      sourceWorkspaceId: workflow.workspaceId,
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
  const consumerWs = await getWorkspaceWithOwner(consumerWorkspaceId)
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
    exposedOutputs,
  } = params

  const [wf] = await db
    .select({ id: workflow.id, workspaceId: workflow.workspaceId, isDeployed: workflow.isDeployed })
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
    type,
    name,
    description,
    iconUrl: iconUrl ?? null,
    enabled: true,
    inputFields: await deriveInputFields(workflowId),
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
    exposedOutputs?: CustomBlockOutput[]
  }
): Promise<void> {
  const patch: Partial<typeof customBlock.$inferInsert> = { updatedAt: new Date() }
  if (updates.name !== undefined) patch.name = updates.name
  if (updates.description !== undefined) patch.description = updates.description
  if (updates.enabled !== undefined) patch.enabled = updates.enabled
  if (updates.exposedOutputs !== undefined) patch.outputs = updates.exposedOutputs
  if (updates.iconUrl !== undefined) patch.iconUrl = updates.iconUrl

  await db.update(customBlock).set(patch).where(eq(customBlock.id, id))
}

/** Unpublish (hard-delete) a custom block. */
export async function deleteCustomBlock(id: string): Promise<void> {
  await db.delete(customBlock).where(eq(customBlock.id, id))
}
