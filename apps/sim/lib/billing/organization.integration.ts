/**
 * A Team subscription accepted for an account with a personal organization converts that
 * organization in place, moves the subscription onto it, and attaches the owner's workspaces, all
 * inside the caller's transaction. Failure mode: one step commits on its own, so a failed workspace
 * attachment leaves a converted Team organization (or a subscription pointed at it) behind while
 * the acceptance reports failure.
 */
import type { SessionPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  member,
  organization,
  outboxEvent,
  project,
  subscription,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'

/** The one injected fault: attaching workspaces fails after everything before it has written. */
const attachFault = vi.hoisted(() => ({ armed: false, outsideTransaction: false }))
vi.mock('@/lib/workspaces/organization-workspaces', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/workspaces/organization-workspaces')>()
  return {
    ...actual,
    attachOwnedWorkspacesToOrganizationTx: async (
      ...args: Parameters<typeof actual.attachOwnedWorkspacesToOrganizationTx>
    ) => {
      if (attachFault.armed) throw new Error('workspace attachment failed')
      return actual.attachOwnedWorkspacesToOrganizationTx(...args)
    },
    attachOwnedWorkspacesToOrganization: async (
      ...args: Parameters<typeof actual.attachOwnedWorkspacesToOrganization>
    ) => {
      if (attachFault.outsideTransaction) throw new Error('workspace attachment failed')
      return actual.attachOwnedWorkspacesToOrganization(...args)
    },
  }
})

import {
  ensureOrganizationForTeamSubscription,
  ensureOrganizationForTeamSubscriptionTx,
  teamPlanWorkspaceAttachOutboxHandlers,
} from '@/lib/billing/organization'
import { TEAM_PLAN_WORKSPACE_ATTACH_EVENT } from '@/lib/billing/organizations/team-plan-attach-event'
import { processOutboxEventById } from '@/lib/core/outbox/service'
import { createTeamOrganization } from '@/lib/organizations/application/team-organizations'
import { createPersonalOrganization } from '@/lib/organizations/provision-personal'
import { createDefaultPersonalWorkspaceInTransaction } from '@/lib/workspaces/create'

const userIds: string[] = []
const subscriptionIds: string[] = []

async function ownerWithPersonalOrganization() {
  const userId = `team-accept-${generateId()}`
  const now = new Date()
  await db.insert(user).values({
    id: userId,
    name: 'Team acceptance owner',
    email: `${userId}@team-accept.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  userIds.push(userId)
  const organizationId = await createPersonalOrganization(userId)
  if (!organizationId) throw new Error('expected a personal organization')
  const subscriptionId = generateId()
  await db
    .insert(subscription)
    .values({ id: subscriptionId, plan: 'team', referenceId: userId, status: 'active', seats: 1 })
  subscriptionIds.push(subscriptionId)
  return { userId, organizationId, subscriptionId }
}

afterAll(async () => {
  attachFault.armed = false
  attachFault.outsideTransaction = false
  await db.delete(outboxEvent).where(eq(outboxEvent.eventType, TEAM_PLAN_WORKSPACE_ATTACH_EVENT))
  if (subscriptionIds.length) {
    await db.delete(subscription).where(inArray(subscription.id, subscriptionIds))
  }
  if (userIds.length) {
    const workspaces = await db
      .select({ id: workspace.id, projectId: workspace.projectId })
      .from(workspace)
      .where(inArray(workspace.ownerId, userIds))
    if (workspaces.length) {
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
    const organizations = await db
      .select({ id: member.organizationId })
      .from(member)
      .where(inArray(member.userId, userIds))
    if (organizations.length) {
      await db.delete(organization).where(
        inArray(
          organization.id,
          organizations.map((row) => row.id)
        )
      )
    }
    await db.delete(user).where(inArray(user.id, userIds))
  }
})

describe('accepting a Team subscription for a personal organization', () => {
  it('rolls the conversion and the subscription move back when attaching workspaces fails', async () => {
    const { userId, organizationId, subscriptionId } = await ownerWithPersonalOrganization()
    attachFault.armed = true

    await expect(
      db.transaction((tx) =>
        ensureOrganizationForTeamSubscriptionTx(
          tx,
          {
            id: subscriptionId,
            plan: 'team',
            referenceId: userId,
            status: 'active',
            seats: 1,
            workspaceIdsToAttach: [],
          },
          { type: 'user', userId }
        )
      )
    ).rejects.toThrow('workspace attachment failed')
    attachFault.armed = false

    const [personal] = await db
      .select({ kind: organization.kind })
      .from(organization)
      .where(eq(organization.id, organizationId))
    expect(personal).toEqual({ kind: 'personal' })
    const [moved] = await db
      .select({ referenceId: subscription.referenceId })
      .from(subscription)
      .where(eq(subscription.id, subscriptionId))
    expect(moved).toEqual({ referenceId: userId })
    const memberships = await db
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(eq(member.userId, userId))
    expect(memberships).toEqual([{ organizationId }])
  })
})

describe('starting a Team from the webhook when attaching workspaces fails', () => {
  it('queues a retry that attaches them and clears the pending marker, without waiting for Stripe', async () => {
    const { userId, organizationId, subscriptionId } = await ownerWithPersonalOrganization()
    const ownerWorkspace = await db.transaction((tx) =>
      createDefaultPersonalWorkspaceInTransaction(tx, {
        userId,
        userName: 'Team acceptance owner',
        personalOrganizationId: organizationId,
      })
    )
    attachFault.outsideTransaction = true

    const resolved = await ensureOrganizationForTeamSubscription(
      { id: subscriptionId, plan: 'team', referenceId: userId, status: 'active', seats: 1 },
      { type: 'system', name: 'Billing webhook' }
    )
    attachFault.outsideTransaction = false

    expect(resolved.referenceId).toBe(organizationId)
    const retries = await db
      .select({ id: outboxEvent.id })
      .from(outboxEvent)
      .where(
        and(
          eq(outboxEvent.eventType, TEAM_PLAN_WORKSPACE_ATTACH_EVENT),
          sql`${outboxEvent.payload}->>'organizationId' = ${organizationId}`
        )
      )
    expect(retries).toHaveLength(1)

    expect(await processOutboxEventById(retries[0].id, teamPlanWorkspaceAttachOutboxHandlers)).toBe(
      'completed'
    )
    const [attached] = await db
      .select({ organizationId: workspace.organizationId })
      .from(workspace)
      .where(eq(workspace.id, ownerWorkspace.id))
    expect(attached).toEqual({ organizationId })
    const [team] = await db
      .select({
        pending: sql<string | null>`${organization.metadata}->>'teamPlanWorkspacesPending'`,
      })
      .from(organization)
      .where(eq(organization.id, organizationId))
    expect(team.pending).toBeNull()
  })
})

describe('creating a team organization from the settings page', () => {
  it('converts the personal organization and moves the subscription together, or neither', async () => {
    const { userId, organizationId } = await ownerWithPersonalOrganization()
    const competingId = generateId()
    await db.insert(subscription).values({
      id: competingId,
      plan: 'team',
      referenceId: organizationId,
      status: 'active',
      seats: 1,
    })
    subscriptionIds.push(competingId)
    const principal: SessionPrincipal = {
      kind: 'session',
      userId,
      sessionId: `session-${generateId()}`,
    }

    await expect(
      createTeamOrganization.execute({ principal, input: { name: 'New team' } })
    ).rejects.toThrow('Organization already has an active subscription')

    const [personal] = await db
      .select({ kind: organization.kind })
      .from(organization)
      .where(eq(organization.id, organizationId))
    expect(personal).toEqual({ kind: 'personal' })
  })
})
