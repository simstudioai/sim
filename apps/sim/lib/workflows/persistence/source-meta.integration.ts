/**
 * Workflow code metadata (the `workflow_source_meta` side table) against real Postgres: it survives
 * a canvas rename (keyed by block id), is pruned when blocks or variables are deleted (and its row
 * removed once nothing is left), follows duplicate and fork onto the copied ids, goes with its
 * workflow on delete, stays off the workflow row, and never counts as a deploy change.
 */
import { db } from '@sim/db'
import {
  user,
  workflow,
  workflowBlocks,
  workflowDeploymentVersion,
  workflowSourceMeta,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { generateId } from '@sim/utils/id'
import {
  type BlockCatalog,
  canonicalize,
  encodeAnchor,
  type WorkflowSourceMetaV1,
} from '@sim/workflow-code'
import {
  pruneWorkflowSourceMeta,
  readWorkflowSourceMeta,
  writeWorkflowSourceMeta,
} from '@sim/workflow-persistence/source-meta'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildLockFromState } from '@/lib/workflows/code/source-lock'
import { checkNeedsRedeployment } from '@/lib/workflows/deployment-status'
import { duplicateWorkflow } from '@/lib/workflows/persistence/duplicate'
import {
  loadWorkflowDeploymentSnapshot,
  saveWorkflowToNormalizedTables,
} from '@/lib/workflows/persistence/utils'
import {
  copyWorkflowStateIntoTarget,
  loadWorkflowNameRegistry,
} from '@/ee/workspace-forking/lib/copy/copy-workflows'
import { deriveForkBlockId } from '@/ee/workspace-forking/lib/remap/block-identity'
import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'

const ownerId = generateId()
const workspaceId = generateId()
const forkWorkspaceId = generateId()
const workflowId = generateId()
const fetchId = generateId()
const sendId = generateId()
const cleanupId = generateId()
const variableId = generateId()
const governance = { workspaceId: null, subjectUserId: null }

/** Identity does not depend on block types, so an empty catalog is enough to canonicalize. */
const EMPTY_CATALOG: BlockCatalog = {
  catalogVersion: 1,
  hash: 'integration',
  sdkMajor: 1,
  blocks: {},
  triggers: {},
  builders: {},
}

function functionBlock(id: string, name: string, y: number): BlockState {
  return {
    id,
    type: 'function',
    name,
    position: { x: 0, y },
    enabled: true,
    outputs: {},
    subBlocks: { code: { id: 'code', type: 'code', value: `return '${name}'` } },
  }
}

function graph(blocks: BlockState[]): WorkflowState {
  const ids = new Set(blocks.map((block) => block.id))
  const edges = [
    { id: generateId(), source: fetchId, target: sendId },
    { id: generateId(), source: sendId, target: cleanupId },
  ].filter((edge) => ids.has(edge.source) && ids.has(edge.target))
  return {
    blocks: Object.fromEntries(blocks.map((block) => [block.id, block])),
    edges,
    loops: {},
    parallels: {},
  }
}

const anchorFetch = encodeAnchor({ kind: 'block', block: fetchId })
const anchorCleanup = encodeAnchor({ kind: 'param', block: cleanupId, param: 'code' })
const anchorVariable = encodeAnchor({ kind: 'var', variable: variableId })
const anchorHeader = encodeAnchor({ kind: 'header' })

const storedMeta: WorkflowSourceMetaV1 = {
  version: 1,
  idents: { [fetchId]: 'fetchUser', [sendId]: 'notify', [cleanupId]: 'tidy' },
  order: { [fetchId]: 0, [sendId]: 1, [cleanupId]: 2 },
  comments: {
    [anchorHeader]: [{ text: ' onboarding flow', kind: 'line', placement: 'leading' }],
    [anchorFetch]: [{ text: ' loads the account', kind: 'line', placement: 'leading' }],
    [anchorCleanup]: [{ text: ' best effort', kind: 'line', placement: 'trailing' }],
    [anchorVariable]: [{ text: ' retry budget', kind: 'line', placement: 'trailing' }],
  },
}

async function storedSourceMeta(id: string): Promise<WorkflowSourceMetaV1> {
  const meta = await readWorkflowSourceMeta(db, id)
  if (!meta) throw new Error(`workflow ${id} has no source meta`)
  return meta
}

async function sourceMetaRowCount(id: string): Promise<number> {
  const rows = await db
    .select({ workflowId: workflowSourceMeta.workflowId })
    .from(workflowSourceMeta)
    .where(eq(workflowSourceMeta.workflowId, id))
  return rows.length
}

async function deployCurrentDraft(): Promise<void> {
  const state = await loadWorkflowDeploymentSnapshot(workflowId)
  if (!state) throw new Error('missing draft')
  await db.insert(workflowDeploymentVersion).values({
    id: generateId(),
    workflowId,
    version: 1,
    state,
    isActive: true,
  })
  await db.update(workflow).set({ isDeployed: true }).where(eq(workflow.id, workflowId))
}

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values({
    id: ownerId,
    name: 'Code meta fixture',
    email: `${ownerId}@source-meta.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await insertWorkspaceFixture(db, [
    { id: workspaceId, name: 'Code meta source', ownerId, billedAccountUserId: ownerId },
    { id: forkWorkspaceId, name: 'Code meta fork', ownerId, billedAccountUserId: ownerId },
  ])
  await db.insert(workflow).values({
    id: workflowId,
    userId: ownerId,
    workspaceId,
    name: 'Code meta fixture',
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
    variables: {
      [variableId]: { id: variableId, workflowId, name: 'retries', type: 'number', value: 3 },
    },
  })
  const saved = await saveWorkflowToNormalizedTables(
    workflowId,
    graph([
      functionBlock(fetchId, 'Fetch user', 0),
      functionBlock(sendId, 'Send email', 100),
      functionBlock(cleanupId, 'Cleanup', 200),
    ]),
    governance
  )
  expect(saved).toEqual({ success: true })
  await deployCurrentDraft()
})

afterAll(async () => {
  await deleteWorkspaceFixture(db, inArray(workspace.id, [workspaceId, forkWorkspaceId]))
  await db.delete(user).where(eq(user.id, ownerId))
  await db.$client.end()
})

describe('workflow_source_meta against real Postgres', () => {
  it('stores source meta in the side table without making the draft differ from its deployment', async () => {
    expect(await checkNeedsRedeployment(workflowId)).toBe(false)
    expect(await sourceMetaRowCount(workflowId)).toBe(0)

    await writeWorkflowSourceMeta(db, workflowId, storedMeta)

    expect(await storedSourceMeta(workflowId)).toEqual(storedMeta)
    expect(await sourceMetaRowCount(workflowId)).toBe(1)
    expect(await checkNeedsRedeployment(workflowId)).toBe(false)
    const snapshot = await loadWorkflowDeploymentSnapshot(workflowId)
    expect(JSON.stringify(snapshot)).not.toContain('fetchUser')
    const [row] = await db.select().from(workflow).where(eq(workflow.id, workflowId))
    expect(JSON.stringify(row)).not.toContain('fetchUser')
  })

  it('overwrites on a second write, and deletes the row when the value becomes empty', async () => {
    const scratchId = generateId()
    const now = new Date()
    await db.insert(workflow).values({
      id: scratchId,
      userId: ownerId,
      workspaceId,
      name: 'Code meta scratch',
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
    })
    await writeWorkflowSourceMeta(db, scratchId, storedMeta)
    const rewritten = { ...storedMeta, idents: { [fetchId]: 'loadUser' } }
    await writeWorkflowSourceMeta(db, scratchId, rewritten)
    expect(await storedSourceMeta(scratchId)).toEqual(rewritten)
    expect(await sourceMetaRowCount(scratchId)).toBe(1)

    await writeWorkflowSourceMeta(db, scratchId, {
      version: 1,
      idents: {},
      order: {},
      comments: {},
    })
    expect(await sourceMetaRowCount(scratchId)).toBe(0)
    expect(await readWorkflowSourceMeta(db, scratchId)).toBeNull()

    await writeWorkflowSourceMeta(db, scratchId, storedMeta)
    await db.delete(workflow).where(eq(workflow.id, scratchId))
    expect(await sourceMetaRowCount(scratchId)).toBe(0)
  })

  it('keeps every entry across a canvas rename, so the lock keeps the ident', async () => {
    await db
      .update(workflowBlocks)
      .set({ name: 'Load profile' })
      .where(eq(workflowBlocks.id, fetchId))

    const meta = await storedSourceMeta(workflowId)
    expect(meta).toEqual(storedMeta)

    const state = await loadWorkflowDeploymentSnapshot(workflowId)
    if (!state) throw new Error('missing draft')
    const canonical = canonicalize(state, {
      catalog: EMPTY_CATALOG,
      meta: { name: 'Code meta fixture', description: null },
    })
    const lock = buildLockFromState(meta, canonical)
    expect(lock.blocks.loadprofile).toMatchObject({ id: fetchId, ident: 'fetchUser', order: 0 })
    expect(lock.variables).toEqual({ retries: variableId })
  })

  it('prunes a deleted block on a full save and a deleted variable on the realtime path', async () => {
    const state = await loadWorkflowDeploymentSnapshot(workflowId)
    if (!state) throw new Error('missing draft')
    const remaining = Object.values(state.blocks).filter((block) => block.id !== cleanupId)
    expect(await saveWorkflowToNormalizedTables(workflowId, graph(remaining), governance)).toEqual({
      success: true,
    })

    const afterDelete = await storedSourceMeta(workflowId)
    expect(afterDelete.idents).toEqual({ [fetchId]: 'fetchUser', [sendId]: 'notify' })
    expect(afterDelete.order).toEqual({ [fetchId]: 0, [sendId]: 1 })
    expect(Object.keys(afterDelete.comments).sort()).toEqual(
      [anchorFetch, anchorVariable, anchorHeader].sort()
    )

    await db.transaction((tx) =>
      pruneWorkflowSourceMeta(tx, workflowId, { variables: (id) => id !== variableId })
    )
    expect(Object.keys((await storedSourceMeta(workflowId)).comments).sort()).toEqual(
      [anchorFetch, anchorHeader].sort()
    )
  })

  it('skips a prune whose read is stale, and removes the row when a prune empties it', async () => {
    const scratchId = generateId()
    const now = new Date()
    await db.insert(workflow).values({
      id: scratchId,
      userId: ownerId,
      workspaceId,
      name: 'Code meta prune scratch',
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
    })
    const onlyFetch: WorkflowSourceMetaV1 = {
      version: 1,
      idents: { [fetchId]: 'fetchUser' },
      order: { [fetchId]: 0 },
      comments: {},
    }
    await writeWorkflowSourceMeta(db, scratchId, onlyFetch)
    await db.transaction((tx) =>
      pruneWorkflowSourceMeta(tx, scratchId, { blocks: (id) => id !== fetchId })
    )
    expect(await sourceMetaRowCount(scratchId)).toBe(0)
    await db.delete(workflow).where(eq(workflow.id, scratchId))
  })

  it('re-keys source meta onto the copy when the workflow is duplicated', async () => {
    const copy = await db.transaction((tx) =>
      duplicateWorkflow({
        sourceWorkflowId: workflowId,
        userId: ownerId,
        name: 'Code meta copy',
        workspaceId,
        tx,
      })
    )

    const copiedBlocks = await db
      .select({ id: workflowBlocks.id, name: workflowBlocks.name })
      .from(workflowBlocks)
      .where(eq(workflowBlocks.workflowId, copy.id))
    const idByName = new Map(copiedBlocks.map((block) => [block.name, block.id]))
    const copiedFetch = idByName.get('Load profile')
    const copiedSend = idByName.get('Send email')
    expect(copiedFetch).toBeDefined()
    expect(copiedFetch).not.toBe(fetchId)

    const meta = await storedSourceMeta(copy.id)
    expect(meta.idents).toEqual({
      [copiedFetch ?? '']: 'fetchUser',
      [copiedSend ?? '']: 'notify',
    })
    expect(Object.keys(meta.comments).sort()).toEqual(
      [encodeAnchor({ kind: 'block', block: copiedFetch ?? '' }), anchorHeader].sort()
    )
    expect(JSON.stringify(meta)).not.toContain(fetchId)
    expect(await storedSourceMeta(workflowId)).toMatchObject({ idents: { [fetchId]: 'fetchUser' } })
  })

  it('re-keys source meta onto the derived block ids when the workflow is forked', async () => {
    const sourceState = await loadWorkflowDeploymentSnapshot(workflowId)
    if (!sourceState) throw new Error('missing draft')
    const targetWorkflowId = generateId()

    await db.transaction(async (tx) => {
      await copyWorkflowStateIntoTarget({
        tx,
        targetWorkflowId,
        targetWorkspaceId: forkWorkspaceId,
        userId: ownerId,
        mode: 'create',
        now: new Date(),
        sourceState,
        sourceMeta: {
          name: 'Code meta fixture',
          description: null,
          folderId: null,
          sortOrder: 0,
        },
        sourceMetaFromWorkflowId: workflowId,
        workflowIdMap: new Map([[workflowId, targetWorkflowId]]),
        folderIdMap: new Map(),
        nameRegistry: await loadWorkflowNameRegistry(tx, forkWorkspaceId),
      })
    })

    const meta = await storedSourceMeta(targetWorkflowId)
    expect(meta.idents).toEqual({
      [deriveForkBlockId(targetWorkflowId, fetchId)]: 'fetchUser',
      [deriveForkBlockId(targetWorkflowId, sendId)]: 'notify',
    })
    expect(meta.order).toEqual({
      [deriveForkBlockId(targetWorkflowId, fetchId)]: 0,
      [deriveForkBlockId(targetWorkflowId, sendId)]: 1,
    })
    expect(JSON.stringify(meta)).not.toContain(fetchId)
  })
})
