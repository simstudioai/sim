/**
 * Webhook delivery's deployment reads against real PostgreSQL: the lookup's
 * trigger-block answer must match the standalone check, and a cached deployment
 * version is only ever served to the workflow it belongs to.
 */
import { db } from '@sim/db'
import { user, webhook, workflow, workflowDeploymentVersion, workspace } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findAllWebhooksForPath } from '@/lib/webhooks/processor'
import {
  blockExistsInDeployment,
  loadWorkflowDeploymentVersionState,
} from '@/lib/workflows/persistence/utils'

const owner = `trigger-block-owner-${generateId()}`
const workspaceId = generateId()
const deployedWorkflow = generateId()
const undeployedWorkflow = generateId()
const deploymentVersion = generateId()
const paths = {
  deployedBlock: `deployed-${generateId()}`,
  missingBlock: `missing-${generateId()}`,
  noDeployment: `legacy-${generateId()}`,
}

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values({
    id: owner,
    name: 'Trigger Block',
    email: `${owner}@trigger-block.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db
    .insert(workspace)
    .values({ id: workspaceId, name: 'Trigger Block', ownerId: owner, billedAccountUserId: owner })
  await db.insert(workflow).values(
    [deployedWorkflow, undeployedWorkflow].map((id) => ({
      id,
      userId: owner,
      workspaceId,
      name: id,
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
      isDeployed: id === deployedWorkflow,
    }))
  )
  await db.insert(workflowDeploymentVersion).values({
    id: deploymentVersion,
    workflowId: deployedWorkflow,
    version: 1,
    isActive: true,
    state: {
      blocks: {
        trigger: {
          id: 'trigger',
          type: 'generic_webhook',
          name: 'Webhook',
          position: { x: 0, y: 0 },
          subBlocks: {},
          outputs: {},
          enabled: true,
        },
      },
      edges: [],
      loops: {},
      parallels: {},
    },
  })
  await db.insert(webhook).values([
    {
      id: generateId(),
      workflowId: deployedWorkflow,
      deploymentVersionId: deploymentVersion,
      blockId: 'trigger',
      path: paths.deployedBlock,
      provider: 'generic',
    },
    {
      id: generateId(),
      workflowId: deployedWorkflow,
      deploymentVersionId: deploymentVersion,
      blockId: 'removed-trigger',
      path: paths.missingBlock,
      provider: 'generic',
    },
    {
      id: generateId(),
      workflowId: undeployedWorkflow,
      blockId: 'trigger',
      path: paths.noDeployment,
      provider: 'generic',
    },
  ])
})

afterAll(async () => {
  await db.delete(workspace).where(eq(workspace.id, workspaceId))
  await db.delete(user).where(eq(user.id, owner))
})

async function lookup(path: string) {
  const targets = await findAllWebhooksForPath({ requestId: 'trigger-block-test', path })
  expect(targets).toHaveLength(1)
  return targets[0]
}

describe('trigger block deployment', () => {
  it('reports a trigger block present in the active deployment', async () => {
    const target = await lookup(paths.deployedBlock)

    expect(target.triggerBlockDeployed).toBe(true)
    expect(await blockExistsInDeployment(deployedWorkflow, 'trigger')).toBe(true)
  })

  it('reports a trigger block the active deployment no longer contains', async () => {
    const target = await lookup(paths.missingBlock)

    expect(target.triggerBlockDeployed).toBe(false)
    expect(await blockExistsInDeployment(deployedWorkflow, 'removed-trigger')).toBe(false)
  })

  it('reports no trigger block for a workflow without an active deployment', async () => {
    const target = await lookup(paths.noDeployment)

    expect(target.triggerBlockDeployed).toBe(false)
    expect(await blockExistsInDeployment(undeployedWorkflow, 'trigger')).toBe(false)
  })

  it('serves a deployment version only to the workflow it belongs to', async () => {
    const state = await loadWorkflowDeploymentVersionState(
      deployedWorkflow,
      deploymentVersion,
      workspaceId
    )
    expect(Object.keys(state.blocks)).toEqual(['trigger'])
    expect(state.deploymentVersionId).toBe(deploymentVersion)

    await expect(
      loadWorkflowDeploymentVersionState(undeployedWorkflow, deploymentVersion, workspaceId)
    ).rejects.toThrow(/was not found/)
  })
})
