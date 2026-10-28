import { db } from '@sim/db'
import { user, workflow, workflowDeploymentVersion, workspace } from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { generateId } from '@sim/utils/id'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  invalidateDeployedStateCache,
  loadDeployedWorkflowState,
} from '@/lib/workflows/persistence/utils'

const ownerId = generateId()
const workspaceId = generateId()
const workflowId = generateId()

function snapshot(url: string) {
  return {
    blocks: {
      api: {
        id: 'api',
        type: 'api',
        name: 'API',
        enabled: true,
        position: { x: 0, y: 0 },
        outputs: {},
        subBlocks: { url: { id: 'url', type: 'short-input', value: url } },
      },
    },
    edges: [],
    loops: {},
    parallels: {},
    variables: { threshold: 5 },
  }
}

async function activate(url: string): Promise<string> {
  const id = generateId()
  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${workflowDeploymentVersion.version}), 0) + 1` })
    .from(workflowDeploymentVersion)
    .where(eq(workflowDeploymentVersion.workflowId, workflowId))
  await db
    .update(workflowDeploymentVersion)
    .set({ isActive: false })
    .where(eq(workflowDeploymentVersion.workflowId, workflowId))
  await db.insert(workflowDeploymentVersion).values({
    id,
    workflowId,
    version: Number(next),
    state: snapshot(url),
    isActive: true,
  })
  return id
}

async function rewriteState(versionId: string, url: string): Promise<void> {
  await db
    .update(workflowDeploymentVersion)
    .set({ state: snapshot(url) })
    .where(eq(workflowDeploymentVersion.id, versionId))
}

const urlOf = (state: Awaited<ReturnType<typeof loadDeployedWorkflowState>>) =>
  state.blocks.api.subBlocks.url.value

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values({
    id: ownerId,
    name: 'Deployed state fixture',
    email: `${ownerId}@deployed-state.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    name: 'Deployed state fixture',
    ownerId,
    billedAccountUserId: ownerId,
  })
  await db.insert(workflow).values({
    id: workflowId,
    userId: ownerId,
    workspaceId,
    name: 'Deployed state fixture',
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
  })
})

beforeEach(() => {
  invalidateDeployedStateCache()
})

afterAll(async () => {
  await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
  await db.delete(user).where(eq(user.id, ownerId))
  await db.$client.end()
})

describe('loadDeployedWorkflowState against real Postgres', () => {
  it('decodes the json state on a cold read and serves the same state from a warm read', async () => {
    const versionId = await activate('https://one.example')

    const cold = await loadDeployedWorkflowState(workflowId, workspaceId)
    const warm = await loadDeployedWorkflowState(workflowId, workspaceId)

    expect(cold.deploymentVersionId).toBe(versionId)
    expect(urlOf(cold)).toBe('https://one.example')
    expect(cold.variables).toEqual({ threshold: 5 })
    expect(warm).toEqual(cold)
  })

  it('reads the new state once a different version is active, even with a cached hint', async () => {
    await activate('https://old.example')
    await loadDeployedWorkflowState(workflowId, workspaceId)

    const newId = await activate('https://new.example')
    const next = await loadDeployedWorkflowState(workflowId, workspaceId)

    expect(next.deploymentVersionId).toBe(newId)
    expect(urlOf(next)).toBe('https://new.example')
  })

  it('re-reads the withheld state when the cached entry was evicted after the hint', async () => {
    const versionId = await activate('https://before.example')
    await loadDeployedWorkflowState(workflowId, workspaceId)

    await rewriteState(versionId, 'https://after.example')
    invalidateDeployedStateCache(versionId)
    const reread = await loadDeployedWorkflowState(workflowId, workspaceId)

    expect(reread.deploymentVersionId).toBe(versionId)
    expect(urlOf(reread)).toBe('https://after.example')
  })

  it('throws NoActiveDeploymentError once nothing is active, whatever the hint holds', async () => {
    await activate('https://gone.example')
    await loadDeployedWorkflowState(workflowId, workspaceId)
    await db
      .update(workflowDeploymentVersion)
      .set({ isActive: false })
      .where(eq(workflowDeploymentVersion.workflowId, workflowId))

    await expect(loadDeployedWorkflowState(workflowId, workspaceId)).rejects.toThrow(
      `Workflow ${workflowId} has no active deployment`
    )
  })
})
