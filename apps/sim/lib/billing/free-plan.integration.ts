/**
 * What the Free plan and the trial edges do against real PostgreSQL: web search is held to paid
 * payers like every hosted tool, a schedule a free payer's run cannot serve turns off at once, the
 * trial-ending reminder goes out once per trial, and only an account's own trial can be ended
 * early (Stripe and mail stubbed at their clients).
 */
import { db } from '@sim/db'
import { subscription, user, userStats, workflowSchedule, workspace } from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import Stripe from 'stripe'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { endProTrial } from '@/lib/billing/application/pro-trial'
import { HostedKeyRequiresPaidPlanError } from '@/lib/billing/core/hosted-key-access'
import {
  handleTrialWillEnd,
  type TrialEndingSubscription,
} from '@/lib/billing/webhooks/plan-notices'
import { executeSearchTool } from '@/lib/internal/search/execute-tool'
import { applyScheduleRunFailureUpdate } from '@/background/schedule-execution'

const { stripeStub, mockSendEmail, mockNotifyScheduleAutoDisabled } = vi.hoisted(() => ({
  stripeStub: { subscriptions: { update: vi.fn() }, invoices: { createPreview: vi.fn() } },
  mockSendEmail: vi.fn(),
  mockNotifyScheduleAutoDisabled: vi.fn(),
}))

vi.mock('@/lib/core/config/env-flags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core/config/env-flags')>()),
  isHosted: true,
  isBillingEnabled: true,
}))

vi.mock('@/lib/billing/stripe-client', () => ({
  requireStripeClient: () => stripeStub,
  getStripeClient: () => stripeStub,
}))

vi.mock('@/lib/messaging/email/mailer', () => ({ sendEmail: mockSendEmail }))

vi.mock('@/lib/workflows/schedules/disable-notifications', () => ({
  notifyScheduleAutoDisabled: mockNotifyScheduleAutoDisabled,
}))

const PRO_PLAN = 'pro_6000'
const DAY_MS = 86_400_000

const userIds: string[] = []
const workspaceIds: string[] = []
const scheduleIds: string[] = []

async function createUser(): Promise<string> {
  const id = `free-plan-user-${generateId()}`
  const now = new Date()
  await db.insert(user).values({
    id,
    name: 'Free Plan Test',
    email: `${id}@free-plan.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(userStats).values({ id: generateId(), userId: id })
  userIds.push(id)
  return id
}

async function createWorkspace(ownerId: string): Promise<string> {
  const id = generateId()
  await insertWorkspaceFixture(db, {
    id,
    ownerId,
    billedAccountUserId: ownerId,
    name: 'Free plan workspace',
  })
  workspaceIds.push(id)
  return id
}

async function addSubscription(
  referenceId: string,
  status: string,
  options: { cancelAtPeriodEnd?: boolean } = {}
) {
  const stripeSubscriptionId = `sub_${generateId()}`
  const now = Date.now()
  await db.insert(subscription).values({
    id: generateId(),
    plan: PRO_PLAN,
    referenceId,
    status,
    stripeSubscriptionId,
    periodStart: new Date(now - DAY_MS),
    periodEnd: new Date(now + 13 * DAY_MS),
    trialStart: status === 'trialing' ? new Date(now - DAY_MS) : null,
    trialEnd: status === 'trialing' ? new Date(now + 13 * DAY_MS) : null,
    cancelAtPeriodEnd: options.cancelAtPeriodEnd ?? false,
  })
  return stripeSubscriptionId
}

function search(userId: string, workspaceId: string) {
  return executeSearchTool({
    toolId: 'search_tool',
    input: { query: 'sim workflows' },
    headers: new Headers(),
    context: { workflowId: 'workflow-under-test', workspaceId, userId },
    requestId: generateId(),
  })
}

function trialWillEnd(stripeSubscriptionId: string, status = 'trialing'): TrialEndingSubscription {
  return {
    id: stripeSubscriptionId,
    status,
    trial_end: Math.floor((Date.now() + 3 * DAY_MS) / 1000),
    items: {
      data: [{ quantity: 1, price: { unit_amount: 2500, recurring: { interval: 'month' } } }],
    },
  }
}

async function addClaimedSchedule() {
  const id = generateId()
  const claimedAt = new Date()
  await db.insert(workflowSchedule).values({
    id,
    triggerType: 'schedule',
    cronExpression: '*/5 * * * *',
    status: 'active',
    failedCount: 0,
    lastQueuedAt: claimedAt,
    nextRunAt: claimedAt,
  })
  scheduleIds.push(id)
  return { id, claimedAt }
}

async function readSchedule(id: string) {
  const [row] = await db
    .select({ status: workflowSchedule.status, failedCount: workflowSchedule.failedCount })
    .from(workflowSchedule)
    .where(eq(workflowSchedule.id, id))
  return row
}

beforeEach(() => {
  stripeStub.subscriptions.update.mockReset()
  stripeStub.subscriptions.update.mockResolvedValue({})
  mockSendEmail.mockReset()
  mockSendEmail.mockResolvedValue({ success: true })
  stripeStub.invoices.createPreview.mockReset()
  stripeStub.invoices.createPreview.mockResolvedValue({ amount_due: 2500 })
  mockNotifyScheduleAutoDisabled.mockReset()
})

afterAll(async () => {
  if (scheduleIds.length > 0) {
    await db.delete(workflowSchedule).where(inArray(workflowSchedule.id, scheduleIds))
  }
  if (workspaceIds.length > 0) {
    await deleteWorkspaceFixture(db, inArray(workspace.id, workspaceIds))
  }
  if (userIds.length > 0) {
    await db.delete(subscription).where(inArray(subscription.referenceId, userIds))
    await db.delete(user).where(inArray(user.id, userIds))
  }
})

describe('web search', () => {
  it('refuses a free payer with the paid-plan 402', async () => {
    const userId = await createUser()
    const workspaceId = await createWorkspace(userId)

    const response = await search(userId, workspaceId)

    expect(response.status).toBe(402)
    const { error } = await response.json()
    expect(error).toBe(new HostedKeyRequiresPaidPlanError('Web Search', { byok: false }).message)
    // Search has no BYOK option, so the refusal must not offer one.
    expect(error).not.toContain('BYOK')
  })

  it('lets a paid payer through to the search provider', async () => {
    const userId = await createUser()
    const workspaceId = await createWorkspace(userId)
    await addSubscription(userId, 'active')

    const response = await search(userId, workspaceId)

    // Past the plan gate, the request reaches the provider step, which has no key under test.
    expect(response.status).toBe(503)
    expect((await response.json()).error).toBe('Search service not configured')
  })
})

describe('applyScheduleRunFailureUpdate', () => {
  it("disables a schedule at once when the run was refused Sim's hosted key", async () => {
    const schedule = await addClaimedSchedule()

    const result = await applyScheduleRunFailureUpdate({
      scheduleId: schedule.id,
      now: new Date(),
      nextRunAt: new Date(Date.now() + 300_000),
      expectedLastQueuedAt: schedule.claimedAt,
      requestId: generateId(),
      context: 'test',
      failureMessage: `Agent 1: ${new HostedKeyRequiresPaidPlanError('claude-sonnet-5-5').message}`,
    })

    expect(result.disabled).toBe(true)
    expect((await readSchedule(schedule.id))?.status).toBe('disabled')
    expect(mockNotifyScheduleAutoDisabled).toHaveBeenCalledWith(
      expect.objectContaining({ scheduleId: schedule.id, reason: 'paid_plan_required' })
    )
  })

  it('keeps counting any other failure toward the consecutive-failure limit', async () => {
    const schedule = await addClaimedSchedule()

    const result = await applyScheduleRunFailureUpdate({
      scheduleId: schedule.id,
      now: new Date(),
      nextRunAt: new Date(Date.now() + 300_000),
      expectedLastQueuedAt: schedule.claimedAt,
      requestId: generateId(),
      context: 'test',
      failureMessage: 'Request timed out',
    })

    expect(result.disabled).toBe(false)
    expect(await readSchedule(schedule.id)).toEqual({ status: 'active', failedCount: 1 })
    expect(mockNotifyScheduleAutoDisabled).not.toHaveBeenCalled()
  })
})

describe('handleTrialWillEnd', () => {
  it('emails the trial reminder once however often Stripe redelivers it', async () => {
    const userId = await createUser()
    const stripeSubscriptionId = await addSubscription(userId, 'trialing')
    const redelivered = trialWillEnd(stripeSubscriptionId)

    await handleTrialWillEnd(redelivered)
    await handleTrialWillEnd(redelivered)

    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: `${userId}@free-plan.test` })
    )
  })

  it('quotes the discounted charge from the invoice preview', async () => {
    const userId = await createUser()
    const stripeSubscriptionId = await addSubscription(userId, 'trialing')
    stripeStub.invoices.createPreview.mockResolvedValue({ amount_due: 1250 })

    await handleTrialWillEnd(trialWillEnd(stripeSubscriptionId))

    expect(mockSendEmail.mock.calls[0]?.[0].html).toContain('$12.50/month')
  })

  it('retries a reminder whose email failed to send', async () => {
    const userId = await createUser()
    const stripeSubscriptionId = await addSubscription(userId, 'trialing')
    const event = trialWillEnd(stripeSubscriptionId)
    mockSendEmail.mockResolvedValueOnce({ success: false, message: 'Failed to send email' })

    await expect(handleTrialWillEnd(event)).rejects.toThrow()
    await handleTrialWillEnd(event)

    expect(mockSendEmail).toHaveBeenCalledTimes(2)
  })

  it('sends nothing for a subscription that is no longer trialing', async () => {
    const userId = await createUser()
    const stripeSubscriptionId = await addSubscription(userId, 'active')

    await handleTrialWillEnd(trialWillEnd(stripeSubscriptionId, 'active'))

    expect(mockSendEmail).not.toHaveBeenCalled()
  })
})

describe('endProTrial', () => {
  function asSession(userId: string) {
    return { kind: 'session', userId, sessionId: generateId() } as const
  }

  it("ends the caller's own trial now", async () => {
    const userId = await createUser()
    const stripeSubscriptionId = await addSubscription(userId, 'trialing')

    await endProTrial.execute({ principal: asSession(userId), input: {} })

    expect(stripeStub.subscriptions.update).toHaveBeenCalledWith(
      stripeSubscriptionId,
      // A declined first charge must leave the trial running, not start a past-due plan.
      { trial_end: 'now', payment_behavior: 'error_if_incomplete' },
      expect.anything()
    )
  })

  it('refuses a trial already cancelled at period end', async () => {
    const userId = await createUser()
    await addSubscription(userId, 'trialing', { cancelAtPeriodEnd: true })

    await expect(endProTrial.execute({ principal: asSession(userId), input: {} })).rejects.toThrow(
      'There is no free trial to end'
    )
    expect(stripeStub.subscriptions.update).not.toHaveBeenCalled()
  })

  it('reports a declined card as a payer error and keeps the trial', async () => {
    const userId = await createUser()
    await addSubscription(userId, 'trialing')
    stripeStub.subscriptions.update.mockRejectedValueOnce(
      new Stripe.errors.StripeCardError({ type: 'card_error', message: 'Your card was declined.' })
    )

    await expect(endProTrial.execute({ principal: asSession(userId), input: {} })).rejects.toThrow(
      'Your card could not be charged'
    )
  })

  it('refuses an account whose plan is already paid', async () => {
    const userId = await createUser()
    await addSubscription(userId, 'active')

    await expect(endProTrial.execute({ principal: asSession(userId), input: {} })).rejects.toThrow(
      'There is no free trial to end'
    )
    expect(stripeStub.subscriptions.update).not.toHaveBeenCalled()
  })

  it("never ends another account's trial", async () => {
    const trialing = await createUser()
    await addSubscription(trialing, 'trialing')
    const caller = await createUser()

    await expect(endProTrial.execute({ principal: asSession(caller), input: {} })).rejects.toThrow(
      'There is no free trial to end'
    )
    expect(stripeStub.subscriptions.update).not.toHaveBeenCalled()
  })
})
