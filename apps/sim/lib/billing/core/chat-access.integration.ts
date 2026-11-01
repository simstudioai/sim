/**
 * The Chat plan verdict against real PostgreSQL credit balances: a hosted free payer is refused
 * Chat until it holds prepaid credits, on both the organization and personal balance paths, and a
 * paid payer is admitted without a balance.
 */
import { db } from '@sim/db'
import { organization, user, userStats } from '@sim/db/schema'
import { envFlagsMock } from '@sim/testing/mocks/env-flags.mock'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { payerHasChatAccess } from '@/lib/billing/core/chat-access'

vi.mock('@/lib/core/config/env-flags', () => ({
  ...envFlagsMock,
  isHosted: true,
  isBillingEnabled: true,
}))

const userIds: string[] = []
const organizationIds: string[] = []

async function createUser(): Promise<string> {
  const id = `chat-access-user-${generateId()}`
  const now = new Date()
  await db.insert(user).values({
    id,
    name: 'Chat Access Test',
    email: `${id}@chat-access.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(userStats).values({ id: generateId(), userId: id })
  userIds.push(id)
  return id
}

async function createOrganization(): Promise<string> {
  const id = `chat-access-org-${generateId()}`
  await db.insert(organization).values({ id, name: 'Chat Access Org', slug: id })
  organizationIds.push(id)
  return id
}

afterAll(async () => {
  if (organizationIds.length > 0) {
    await db.delete(organization).where(inArray(organization.id, organizationIds))
  }
  if (userIds.length > 0) await db.delete(user).where(inArray(user.id, userIds))
})

describe('payerHasChatAccess', () => {
  it('refuses a free organization payer until it holds prepaid credits', async () => {
    const organizationId = await createOrganization()
    const payer = {
      billingEntity: { type: 'organization' as const, id: organizationId },
      payerSubscription: null,
    }

    expect(await payerHasChatAccess(payer)).toBe(false)

    await db
      .update(organization)
      .set({ creditBalance: '25' })
      .where(eq(organization.id, organizationId))

    expect(await payerHasChatAccess(payer)).toBe(true)
  })

  it('refuses a free personal payer until it holds prepaid credits', async () => {
    const userId = await createUser()
    const payer = {
      billingEntity: { type: 'user' as const, id: userId },
      payerSubscription: { plan: 'free' },
    }

    expect(await payerHasChatAccess(payer)).toBe(false)

    await db.update(userStats).set({ creditBalance: '10' }).where(eq(userStats.userId, userId))

    expect(await payerHasChatAccess(payer)).toBe(true)
  })

  it('admits a paid payer that holds no credits', async () => {
    const userId = await createUser()

    expect(
      await payerHasChatAccess({
        billingEntity: { type: 'user', id: userId },
        payerSubscription: { plan: 'pro_6000' },
      })
    ).toBe(true)
  })
})
