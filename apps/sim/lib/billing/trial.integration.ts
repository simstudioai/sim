/**
 * The Pro free trial against real PostgreSQL: which checkouts start a trial, how each card and
 * account is held to one trial (with Stripe stubbed at its client), and the trial's usage limit
 * from start through conversion.
 */
import { db } from '@sim/db'
import { subscription, trialCard, user, userStats } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import type Stripe from 'stripe'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PRO_TRIAL_DAYS, PRO_TRIAL_USAGE_LIMIT_DOLLARS } from '@/lib/billing/constants'
import { syncUsageLimitsFromSubscription, updateUserUsageLimit } from '@/lib/billing/core/usage'
import { setUsageLimitForCredits } from '@/lib/billing/credits/purchase'
import {
  enforceOneTrialPerCard,
  enforceOneTrialPerCardForCheckout,
  getProTrialCheckoutParams,
} from '@/lib/billing/trial'

const { stripeStub } = vi.hoisted(() => ({
  stripeStub: {
    paymentMethods: { retrieve: vi.fn() },
    subscriptions: { retrieve: vi.fn(), update: vi.fn() },
  },
}))

vi.mock('@/lib/billing/stripe-client', () => ({
  requireStripeClient: () => stripeStub,
  getStripeClient: () => stripeStub,
}))

const PRO_PLAN = 'pro_6000'
const PRO_BASE_DOLLARS = 30

const userIds: string[] = []
const fingerprints: string[] = []

async function createUser(options: { freeTierEligible?: boolean } = {}): Promise<string> {
  const id = `trial-user-${generateId()}`
  const now = new Date()
  await db.insert(user).values({
    id,
    name: 'Trial Test',
    email: `${id}@trial.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(userStats).values({
    id: generateId(),
    userId: id,
    freeTierEligible: options.freeTierEligible ?? true,
  })
  userIds.push(id)
  return id
}

async function addSubscription(
  referenceId: string,
  fields: { status: string; plan?: string; trialStart?: Date | null; stripeSubscriptionId?: string }
): Promise<string> {
  const id = generateId()
  const now = Date.now()
  await db.insert(subscription).values({
    id,
    plan: fields.plan ?? PRO_PLAN,
    referenceId,
    status: fields.status,
    stripeSubscriptionId: fields.stripeSubscriptionId ?? `sub_${generateId()}`,
    periodStart: new Date(now),
    periodEnd: new Date(now + PRO_TRIAL_DAYS * 86_400_000),
    trialStart: fields.trialStart ?? null,
    trialEnd: fields.trialStart ? new Date(now + PRO_TRIAL_DAYS * 86_400_000) : null,
  })
  return id
}

function trialingStripeSubscription(
  id: string,
  defaultPaymentMethod: string | null
): Stripe.Subscription {
  return {
    id,
    status: 'trialing',
    default_payment_method: defaultPaymentMethod,
  } as Stripe.Subscription
}

function payer(userId: string): { plan: string; referenceId: string } {
  return { plan: PRO_PLAN, referenceId: userId }
}

function useCard(fingerprint: string | null): void {
  if (fingerprint) fingerprints.push(fingerprint)
  stripeStub.paymentMethods.retrieve.mockResolvedValue({
    id: `pm_${generateId()}`,
    card: fingerprint ? { fingerprint } : undefined,
  })
}

async function readLimit(userId: string): Promise<number> {
  const [stats] = await db
    .select({ currentUsageLimit: userStats.currentUsageLimit })
    .from(userStats)
    .where(eq(userStats.userId, userId))
  return Number(stats?.currentUsageLimit)
}

beforeEach(() => {
  stripeStub.paymentMethods.retrieve.mockReset()
  stripeStub.subscriptions.retrieve.mockReset()
  stripeStub.subscriptions.update.mockReset()
  stripeStub.subscriptions.update.mockResolvedValue({})
})

afterAll(async () => {
  if (fingerprints.length > 0) {
    await db.delete(trialCard).where(inArray(trialCard.fingerprint, fingerprints))
  }
  if (userIds.length > 0) {
    await db.delete(subscription).where(inArray(subscription.referenceId, userIds))
    await db.delete(user).where(inArray(user.id, userIds))
  }
})

describe('getProTrialCheckoutParams', () => {
  it("starts a card-required trial for a new account's personal Pro checkout", async () => {
    const userId = await createUser()
    // The incomplete row the Stripe plugin writes before building the checkout.
    await addSubscription(userId, { status: 'incomplete' })

    const params = await getProTrialCheckoutParams({
      userId,
      referenceId: userId,
      planName: PRO_PLAN,
    })

    expect(params).toEqual({
      payment_method_types: ['card'],
      payment_method_collection: 'always',
      subscription_data: {
        trial_period_days: PRO_TRIAL_DAYS,
        trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
      },
    })
  })

  it('still offers the trial after an abandoned checkout', async () => {
    const userId = await createUser()
    await addSubscription(userId, { status: 'incomplete_expired' })

    expect(
      await getProTrialCheckoutParams({ userId, referenceId: userId, planName: PRO_PLAN })
    ).not.toBeNull()
  })

  it.each([
    { label: 'Max', planName: 'pro_25000', organization: false },
    { label: 'a team plan', planName: 'team_6000', organization: false },
    { label: 'an organization checkout', planName: PRO_PLAN, organization: true },
  ])('offers no trial for $label', async ({ planName, organization }) => {
    const userId = await createUser()

    expect(
      await getProTrialCheckoutParams({
        userId,
        referenceId: organization ? `org-${generateId()}` : userId,
        planName,
      })
    ).toBeNull()
  })

  it('offers no trial to an account that already trialed', async () => {
    const userId = await createUser()
    await addSubscription(userId, { status: 'canceled', trialStart: new Date() })

    expect(
      await getProTrialCheckoutParams({ userId, referenceId: userId, planName: PRO_PLAN })
    ).toBeNull()
  })

  it('offers no trial to an account that already paid for a plan', async () => {
    const userId = await createUser()
    await addSubscription(userId, { status: 'canceled' })

    expect(
      await getProTrialCheckoutParams({ userId, referenceId: userId, planName: PRO_PLAN })
    ).toBeNull()
  })

  it("offers no trial to an account reusing a deleted account's identity", async () => {
    const userId = await createUser({ freeTierEligible: false })

    expect(
      await getProTrialCheckoutParams({ userId, referenceId: userId, planName: PRO_PLAN })
    ).toBeNull()
  })
})

describe('enforceOneTrialPerCard', () => {
  it("keeps a card's first trial and records the card", async () => {
    const userId = await createUser()
    const stripeSubscriptionId = `sub_${generateId()}`
    await addSubscription(userId, {
      status: 'trialing',
      trialStart: new Date(),
      stripeSubscriptionId,
    })
    const fingerprint = `fp_${generateId()}`
    useCard(fingerprint)

    expect(
      await enforceOneTrialPerCard(
        trialingStripeSubscription(stripeSubscriptionId, 'pm_1'),
        payer(userId)
      )
    ).toBe(true)

    expect(stripeStub.subscriptions.update).not.toHaveBeenCalled()
    const [claim] = await db.select().from(trialCard).where(eq(trialCard.fingerprint, fingerprint))
    expect(claim).toMatchObject({ userId, stripeSubscriptionId })
  })

  it('keeps the trial when the same checkout webhook is delivered again', async () => {
    const userId = await createUser()
    const stripeSubscriptionId = `sub_${generateId()}`
    await addSubscription(userId, {
      status: 'trialing',
      trialStart: new Date(),
      stripeSubscriptionId,
    })
    useCard(`fp_${generateId()}`)
    const trial = trialingStripeSubscription(stripeSubscriptionId, 'pm_1')

    expect(await enforceOneTrialPerCard(trial, payer(userId))).toBe(true)
    expect(await enforceOneTrialPerCard(trial, payer(userId))).toBe(true)
    expect(stripeStub.subscriptions.update).not.toHaveBeenCalled()
  })

  it("ends a second account's trial on a card that already trialed, even after the first account is deleted", async () => {
    const fingerprint = `fp_${generateId()}`
    useCard(fingerprint)
    const firstUserId = await createUser()
    const firstSubscriptionId = `sub_${generateId()}`
    await addSubscription(firstUserId, {
      status: 'trialing',
      trialStart: new Date(),
      stripeSubscriptionId: firstSubscriptionId,
    })
    expect(
      await enforceOneTrialPerCard(
        trialingStripeSubscription(firstSubscriptionId, 'pm_1'),
        payer(firstUserId)
      )
    ).toBe(true)
    await db.delete(subscription).where(eq(subscription.referenceId, firstUserId))
    await db.delete(user).where(eq(user.id, firstUserId))

    const secondUserId = await createUser()
    const secondSubscriptionId = `sub_${generateId()}`
    await addSubscription(secondUserId, {
      status: 'trialing',
      trialStart: new Date(),
      stripeSubscriptionId: secondSubscriptionId,
    })

    expect(
      await enforceOneTrialPerCard(
        trialingStripeSubscription(secondSubscriptionId, 'pm_2'),
        payer(secondUserId)
      )
    ).toBe(false)
    expect(stripeStub.subscriptions.update).toHaveBeenCalledExactlyOnceWith(
      secondSubscriptionId,
      { trial_end: 'now' },
      { idempotencyKey: `end-ineligible-trial:${secondSubscriptionId}` }
    )
    const [claim] = await db.select().from(trialCard).where(eq(trialCard.fingerprint, fingerprint))
    expect(claim).toMatchObject({ userId: null, stripeSubscriptionId: firstSubscriptionId })
  })

  it('ends a trial whose card cannot be identified', async () => {
    const userId = await createUser()
    const stripeSubscriptionId = `sub_${generateId()}`
    await addSubscription(userId, {
      status: 'trialing',
      trialStart: new Date(),
      stripeSubscriptionId,
    })

    expect(
      await enforceOneTrialPerCard(
        trialingStripeSubscription(stripeSubscriptionId, null),
        payer(userId)
      )
    ).toBe(false)
    expect(stripeStub.subscriptions.update).toHaveBeenCalledOnce()
  })

  it("ends an account's racing second trial and keeps the first through a redelivery", async () => {
    const userId = await createUser()
    const firstSubscriptionId = `sub_${generateId()}`
    const racingSubscriptionId = `sub_${generateId()}`
    for (const stripeSubscriptionId of [firstSubscriptionId, racingSubscriptionId]) {
      await addSubscription(userId, {
        status: 'trialing',
        trialStart: new Date(),
        stripeSubscriptionId,
      })
    }
    const firstCard = `fp_${generateId()}`

    useCard(firstCard)
    expect(
      await enforceOneTrialPerCard(
        trialingStripeSubscription(firstSubscriptionId, 'pm_1'),
        payer(userId)
      )
    ).toBe(true)

    useCard(`fp_${generateId()}`)
    expect(
      await enforceOneTrialPerCard(
        trialingStripeSubscription(racingSubscriptionId, 'pm_2'),
        payer(userId)
      )
    ).toBe(false)
    expect(stripeStub.subscriptions.update).toHaveBeenCalledExactlyOnceWith(
      racingSubscriptionId,
      { trial_end: 'now' },
      { idempotencyKey: `end-ineligible-trial:${racingSubscriptionId}` }
    )

    useCard(firstCard)
    expect(
      await enforceOneTrialPerCard(
        trialingStripeSubscription(firstSubscriptionId, 'pm_1'),
        payer(userId)
      )
    ).toBe(true)
    expect(stripeStub.subscriptions.update).toHaveBeenCalledOnce()
  })

  it('keeps exactly one of two checkouts racing on one account', async () => {
    const userId = await createUser()
    const racing = [`sub_${generateId()}`, `sub_${generateId()}`]
    for (const stripeSubscriptionId of racing) {
      await addSubscription(userId, {
        status: 'trialing',
        trialStart: new Date(),
        stripeSubscriptionId,
      })
    }
    const cards = racing.map(() => `fp_${generateId()}`)
    fingerprints.push(...cards)
    stripeStub.paymentMethods.retrieve.mockImplementation(async (id: string) => ({
      id,
      card: { fingerprint: cards[Number(id.slice(3))] },
    }))

    const kept = await Promise.all(
      racing.map((stripeSubscriptionId, index) =>
        enforceOneTrialPerCard(
          trialingStripeSubscription(stripeSubscriptionId, `pm_${index}`),
          payer(userId)
        )
      )
    )

    expect(kept.filter(Boolean)).toHaveLength(1)
    expect(stripeStub.subscriptions.update).toHaveBeenCalledOnce()
  })

  it('leaves a trial on any plan other than Pro alone', async () => {
    const userId = await createUser()

    expect(
      await enforceOneTrialPerCard(trialingStripeSubscription(`sub_${generateId()}`, 'pm_1'), {
        plan: 'team_6000',
        referenceId: userId,
      })
    ).toBe(false)
    expect(stripeStub.paymentMethods.retrieve).not.toHaveBeenCalled()
    expect(stripeStub.subscriptions.update).not.toHaveBeenCalled()
  })

  it('leaves a checkout that did not start a trial alone', async () => {
    const userId = await createUser()

    expect(
      await enforceOneTrialPerCard(
        { id: `sub_${generateId()}`, status: 'active' } as Stripe.Subscription,
        payer(userId)
      )
    ).toBe(false)
    expect(stripeStub.paymentMethods.retrieve).not.toHaveBeenCalled()
    expect(stripeStub.subscriptions.update).not.toHaveBeenCalled()
  })
})

describe('enforceOneTrialPerCardForCheckout', () => {
  it("judges a completed checkout's trial by the subscription Sim recorded for it", async () => {
    const fingerprint = `fp_${generateId()}`
    useCard(fingerprint)
    const firstUserId = await createUser()
    const firstSubscriptionId = `sub_${generateId()}`
    await addSubscription(firstUserId, {
      status: 'trialing',
      trialStart: new Date(),
      stripeSubscriptionId: firstSubscriptionId,
    })
    await enforceOneTrialPerCard(
      trialingStripeSubscription(firstSubscriptionId, 'pm_1'),
      payer(firstUserId)
    )

    const userId = await createUser()
    const stripeSubscriptionId = `sub_${generateId()}`
    await addSubscription(userId, {
      status: 'trialing',
      trialStart: new Date(),
      stripeSubscriptionId,
    })
    stripeStub.subscriptions.retrieve.mockResolvedValue(
      trialingStripeSubscription(stripeSubscriptionId, 'pm_2')
    )

    await enforceOneTrialPerCardForCheckout({
      mode: 'subscription',
      subscription: stripeSubscriptionId,
    } as Stripe.Checkout.Session)

    expect(stripeStub.subscriptions.update).toHaveBeenCalledExactlyOnceWith(
      stripeSubscriptionId,
      { trial_end: 'now' },
      { idempotencyKey: `end-ineligible-trial:${stripeSubscriptionId}` }
    )
  })

  it('fails, so the webhook retries, for a trial Sim has not recorded yet', async () => {
    const stripeSubscriptionId = `sub_${generateId()}`
    stripeStub.subscriptions.retrieve.mockResolvedValue(
      trialingStripeSubscription(stripeSubscriptionId, 'pm_1')
    )

    await expect(
      enforceOneTrialPerCardForCheckout({
        mode: 'subscription',
        subscription: stripeSubscriptionId,
      } as Stripe.Checkout.Session)
    ).rejects.toThrow('is not recorded yet')
    expect(stripeStub.subscriptions.update).not.toHaveBeenCalled()
  })
})

describe('the trial usage limit', () => {
  it("holds a trial to its allowance, lowering a limit an earlier plan left higher, until it converts to the plan's base", async () => {
    const userId = await createUser()
    await db
      .update(userStats)
      .set({ currentUsageLimit: '500', creditBalance: '2' })
      .where(eq(userStats.userId, userId))
    const subscriptionId = await addSubscription(userId, {
      status: 'trialing',
      trialStart: new Date(),
    })

    await syncUsageLimitsFromSubscription(userId)
    expect(await readLimit(userId)).toBe(PRO_TRIAL_USAGE_LIMIT_DOLLARS + 2)

    await db
      .update(subscription)
      .set({ status: 'active' })
      .where(eq(subscription.id, subscriptionId))
    await syncUsageLimitsFromSubscription(userId)
    expect(await readLimit(userId)).toBe(PRO_BASE_DOLLARS + 2)
  })

  it('raises a trial limit by granted credits from the trial allowance, not the plan base', async () => {
    const userId = await createUser()
    await addSubscription(userId, { status: 'trialing', trialStart: new Date() })
    await syncUsageLimitsFromSubscription(userId)

    await setUsageLimitForCredits('user', userId, { plan: PRO_PLAN, status: 'trialing' }, null, 1)

    expect(await readLimit(userId)).toBe(PRO_TRIAL_USAGE_LIMIT_DOLLARS + 1)
  })

  it('refuses to raise the limit during a trial', async () => {
    const userId = await createUser()
    await addSubscription(userId, { status: 'trialing', trialStart: new Date() })
    await syncUsageLimitsFromSubscription(userId)

    expect(await updateUserUsageLimit(userId, 999_999)).toEqual({
      success: false,
      error: 'Usage limits can be changed once your trial ends',
    })
    expect(await readLimit(userId)).toBe(PRO_TRIAL_USAGE_LIMIT_DOLLARS)
  })
})
