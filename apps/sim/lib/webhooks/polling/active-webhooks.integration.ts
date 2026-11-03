import { db } from '@sim/db'
import { user, webhook, workflow, workspace } from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fetchActiveWebhooks } from '@/lib/webhooks/polling/utils'

const owner = generateId()
const workspaceIds = [generateId(), generateId()]
const provider = `table-scope-${generateId()}`

const fixtures = workspaceIds.flatMap((workspaceId) =>
  [true, false].map((isDeployed) => ({
    workspaceId,
    isDeployed,
    workflowId: generateId(),
    webhookId: generateId(),
  }))
)

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values({
    id: owner,
    name: 'Active webhooks fixture',
    email: `${owner}@active-webhooks.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await insertWorkspaceFixture(
    db,
    workspaceIds.map((id) => ({
      id,
      name: 'Active webhooks fixture',
      ownerId: owner,
      billedAccountUserId: owner,
    }))
  )
  await db.insert(workflow).values(
    fixtures.map((fixture) => ({
      id: fixture.workflowId,
      userId: owner,
      workspaceId: fixture.workspaceId,
      name: fixture.workflowId,
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
      isDeployed: fixture.isDeployed,
    }))
  )
  await db.insert(webhook).values(
    fixtures.map((fixture) => ({
      id: fixture.webhookId,
      workflowId: fixture.workflowId,
      blockId: 'trigger',
      path: `active-webhooks-${fixture.webhookId}`,
      provider,
      providerConfig: { tableId: 'tbl_1', eventType: 'insert' },
    }))
  )
})

afterAll(async () => {
  await deleteWorkspaceFixture(db, inArray(workspace.id, workspaceIds))
  await db.delete(user).where(eq(user.id, owner))
  await db.$client.end()
})

describe('fetchActiveWebhooks workspace scope', () => {
  it('returns exactly the unscoped result restricted to the workspace', async () => {
    const all = await fetchActiveWebhooks(provider)
    expect(all.map((entry) => entry.webhook.id).sort()).toEqual(
      fixtures
        .filter((fixture) => fixture.isDeployed)
        .map((fixture) => fixture.webhookId)
        .sort()
    )

    for (const workspaceId of workspaceIds) {
      const scoped = await fetchActiveWebhooks(provider, { workspaceId })
      expect(scoped).toEqual(all.filter((entry) => entry.workflow.workspaceId === workspaceId))
      expect(scoped).toHaveLength(1)
    }
  })

  it('returns nothing for a workspace with no webhooks of the provider', async () => {
    expect(await fetchActiveWebhooks(provider, { workspaceId: generateId() })).toEqual([])
  })
})
