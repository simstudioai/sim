/**
 * Workspace tier gates on a hosted, billed deployment follow the workspace's payer: a workspace in
 * a personal organization is paid for by its owner's own subscription, exactly as it was while it
 * had no organization, so attaching it never takes a paid feature away.
 */
import { db } from '@sim/db'
import {
  member,
  organization,
  project,
  subscription,
  user,
  userStats,
  workspace,
} from '@sim/db/schema'
import { deleteOutboxEventsNaming } from '@sim/db/testing/outbox-fixtures'
import { generateId } from '@sim/utils/id'
import { inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.BILLING_ENABLED = 'true'
  process.env.NEXT_PUBLIC_FORCE_HOSTED = 'true'
})

import { hasWorkspaceLiveSyncAccess } from '@/lib/billing/core/subscription'
import { provisionPersonalOrganization } from '@/lib/organizations/provision-personal'
import { createWorkspaceInTransaction } from '@/lib/workspaces/create'

const userIds: string[] = []

async function createUser(): Promise<string> {
  const id = `personal-billing-user-${generateId()}`
  const now = new Date()
  await db.insert(user).values({
    id,
    name: 'Personal Billing Test',
    email: `${id}@personal-billing.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(userStats).values({ id: generateId(), userId: id })
  userIds.push(id)
  return id
}

afterAll(async () => {
  if (userIds.length === 0) return
  const workspaces = await db
    .select({ id: workspace.id, projectId: workspace.projectId })
    .from(workspace)
    .where(inArray(workspace.ownerId, userIds))
  const organizations = await db
    .select({ id: member.organizationId })
    .from(member)
    .where(inArray(member.userId, userIds))
  await deleteOutboxEventsNaming(db, [...userIds, ...organizations.map((row) => row.id)])
  await db.delete(subscription).where(inArray(subscription.referenceId, userIds))
  if (workspaces.length > 0) {
    await db.delete(workspace).where(
      inArray(
        workspace.id,
        workspaces.map((row) => row.id)
      )
    )
    await db.delete(project).where(
      inArray(
        project.id,
        workspaces.flatMap((row) => (row.projectId ? [row.projectId] : []))
      )
    )
  }
  if (organizations.length > 0) {
    await db.delete(organization).where(
      inArray(
        organization.id,
        organizations.map((row) => row.id)
      )
    )
  }
  await db.delete(user).where(inArray(user.id, userIds))
})

describe('workspace tier gates in a personal organization', () => {
  it('keeps a Max owner on Max-tier features after their workspace joins the personal organization', async () => {
    const ownerId = await createUser()
    const created = await db.transaction((tx) =>
      createWorkspaceInTransaction(tx, {
        userId: ownerId,
        name: 'Max workspace',
        organizationId: null,
        observedOrganizationId: null,
        governingPermissionGroupOrganizationId: null,
        workspaceMode: 'personal',
        billedAccountUserId: ownerId,
        skipDefaultWorkflow: true,
      })
    )
    await db.insert(subscription).values({
      id: generateId(),
      plan: 'pro_25000',
      referenceId: ownerId,
      status: 'active',
    })

    const provisioned = await provisionPersonalOrganization(ownerId)
    if (provisioned.status !== 'provisioned') throw new Error('expected provisioning')
    expect(provisioned.attachedWorkspaceIds).toEqual([created.id])

    expect(await hasWorkspaceLiveSyncAccess(created.id)).toBe(true)
  })
})
