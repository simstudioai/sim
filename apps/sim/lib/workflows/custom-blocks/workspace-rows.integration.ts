/** The custom-block rows an execution overlays, read against real PostgreSQL. */
import { db } from '@sim/db'
import { customBlock, organization, user, workflow, workspace } from '@sim/db/schema'
import {
  billingSubscriptionMock,
  billingSubscriptionMockFns,
} from '@sim/testing/mocks/billing-subscription.mock'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/billing/core/subscription', () => billingSubscriptionMock)

import { getCustomBlockRowsForWorkspace } from '@/lib/workflows/custom-blocks/operations'

const mockIsOrganizationFeatureEntitled =
  billingSubscriptionMockFns.mockIsOrganizationFeatureEntitled
const owner = `custom-rows-owner-${generateId()}`
const organizations = { withBlocks: `org-${generateId()}`, withoutBlocks: `org-${generateId()}` }
const workspaces = {
  withBlocks: generateId(),
  withoutBlocks: generateId(),
  personal: generateId(),
}
const sourceWorkflow = generateId()

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values({
    id: owner,
    name: 'Custom Rows',
    email: `${owner}@custom-rows.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(organization).values([
    { id: organizations.withBlocks, name: 'With Blocks', slug: organizations.withBlocks },
    { id: organizations.withoutBlocks, name: 'Without Blocks', slug: organizations.withoutBlocks },
  ])
  await db.insert(workspace).values([
    {
      id: workspaces.withBlocks,
      name: 'With Blocks',
      ownerId: owner,
      billedAccountUserId: owner,
      organizationId: organizations.withBlocks,
    },
    {
      id: workspaces.withoutBlocks,
      name: 'Without Blocks',
      ownerId: owner,
      billedAccountUserId: owner,
      organizationId: organizations.withoutBlocks,
    },
    { id: workspaces.personal, name: 'Personal', ownerId: owner, billedAccountUserId: owner },
  ])
  await db.insert(workflow).values({
    id: sourceWorkflow,
    userId: owner,
    workspaceId: workspaces.withBlocks,
    name: 'Source',
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(customBlock).values([
    {
      id: generateId(),
      organizationId: organizations.withBlocks,
      workflowId: sourceWorkflow,
      type: `custom_block_${generateId()}`,
      name: 'Enabled',
      outputs: [{ blockId: 'b1', path: 'result', name: 'result' }],
    },
    {
      id: generateId(),
      organizationId: organizations.withBlocks,
      workflowId: sourceWorkflow,
      type: `custom_block_${generateId()}`,
      name: 'Disabled',
      enabled: false,
    },
  ])
})

beforeEach(() => {
  mockIsOrganizationFeatureEntitled.mockReset()
  mockIsOrganizationFeatureEntitled.mockResolvedValue(true)
})

afterAll(async () => {
  await db.delete(workspace).where(inArray(workspace.id, Object.values(workspaces)))
  await db.delete(organization).where(inArray(organization.id, Object.values(organizations)))
  await db.delete(user).where(eq(user.id, owner))
})

describe('getCustomBlockRowsForWorkspace', () => {
  it('returns every block of an entitled organization, disabled ones included', async () => {
    const rows = await getCustomBlockRowsForWorkspace(workspaces.withBlocks)

    expect(rows.map((row) => row.name).sort()).toEqual(['Disabled', 'Enabled'])
    expect(rows.find((row) => row.name === 'Enabled')).toMatchObject({
      workflowId: sourceWorkflow,
      enabled: true,
      exposedOutputs: [{ blockId: 'b1', path: 'result', name: 'result' }],
    })
    expect(rows.find((row) => row.name === 'Disabled')).toMatchObject({
      enabled: false,
      exposedOutputs: [],
    })
  })

  it('returns nothing for an organization that is not entitled', async () => {
    mockIsOrganizationFeatureEntitled.mockResolvedValue(false)

    expect(await getCustomBlockRowsForWorkspace(workspaces.withBlocks)).toEqual([])
  })

  it('returns nothing for an organization without blocks or a workspace without one', async () => {
    expect(await getCustomBlockRowsForWorkspace(workspaces.withoutBlocks)).toEqual([])
    expect(await getCustomBlockRowsForWorkspace(workspaces.personal)).toEqual([])
    expect(await getCustomBlockRowsForWorkspace(generateId())).toEqual([])
  })
})
