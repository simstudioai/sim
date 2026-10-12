/**
 * Stable webhook registration against real PostgreSQL: a deploy must not claim
 * a path another workflow already serves through an unclaimed legacy row.
 */
import { db } from '@sim/db'
import {
  user,
  webhook,
  webhookPathClaim,
  workflow,
  workflowDeploymentOperation,
  workflowDeploymentVersion,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WebhookPathClaimConflictError } from '@/lib/webhooks/path-claims'
import {
  prepareWebhookRegistrationIntents,
  type WebhookRegistrationOperationFence,
} from '@/lib/webhooks/registration-store'

const owner = `registration-store-owner-${generateId()}`
const workspaceId = generateId()
const victimWorkflow = generateId()
const deployingWorkflow = generateId()
const victimVersion = generateId()
const deployingVersion = generateId()
const legacyPath = `legacy-${generateId()}`
const freePath = `free-${generateId()}`

const fence: WebhookRegistrationOperationFence = {
  workflowId: deployingWorkflow,
  operationId: generateId(),
  generation: 1,
  deploymentVersionId: deployingVersion,
}

function desiredFor(path: string) {
  return {
    blockId: 'trigger',
    provider: 'generic',
    path,
    routingKey: null,
    providerConfig: {},
    configFingerprint: `fp-${path}`,
  }
}

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values({
    id: owner,
    name: 'Registration Store',
    email: `${owner}@registration-store.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(workspace).values({
    id: workspaceId,
    name: 'Registration Store',
    ownerId: owner,
    billedAccountUserId: owner,
  })
  await db.insert(workflow).values(
    [victimWorkflow, deployingWorkflow].map((id) => ({
      id,
      userId: owner,
      workspaceId,
      name: id,
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
      isDeployed: id === victimWorkflow,
    }))
  )
  const emptyState = { blocks: {}, edges: [], loops: {}, parallels: {} }
  await db.insert(workflowDeploymentVersion).values([
    {
      id: victimVersion,
      workflowId: victimWorkflow,
      version: 1,
      isActive: true,
      state: emptyState,
    },
    { id: deployingVersion, workflowId: deployingWorkflow, version: 1, state: emptyState },
  ])
  await db.insert(webhook).values({
    id: generateId(),
    workflowId: victimWorkflow,
    deploymentVersionId: victimVersion,
    blockId: 'trigger',
    path: legacyPath,
    provider: 'generic',
    providerConfig: {},
  })
  await db.insert(workflowDeploymentOperation).values({
    id: fence.operationId,
    workflowId: deployingWorkflow,
    deploymentVersionId: deployingVersion,
    version: 1,
    action: 'deploy',
    protocolVersion: 2,
    generation: fence.generation,
    status: 'preparing',
    requestHash: generateId(),
    actorId: owner,
  })
})

afterAll(async () => {
  await db.delete(workspace).where(eq(workspace.id, workspaceId))
  await db.delete(user).where(eq(user.id, owner))
})

async function claimOwner(path: string) {
  const [claim] = await db
    .select({ workflowId: webhookPathClaim.workflowId })
    .from(webhookPathClaim)
    .where(eq(webhookPathClaim.path, path))
  return claim?.workflowId ?? null
}

describe('prepareWebhookRegistrationIntents path ownership', () => {
  it.each([legacyPath, `/${legacyPath}/`])(
    'refuses to claim %s while another workflow serves it unclaimed',
    async (path) => {
      await expect(
        prepareWebhookRegistrationIntents({ fence, desired: [desiredFor(path)] })
      ).rejects.toBeInstanceOf(WebhookPathClaimConflictError)
      expect(await claimOwner(legacyPath)).toBeNull()
    }
  )

  it('claims a path no other workflow serves', async () => {
    await prepareWebhookRegistrationIntents({ fence, desired: [desiredFor(freePath)] })
    expect(await claimOwner(freePath)).toBe(deployingWorkflow)
  })
})
