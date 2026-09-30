import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { billingCoreMock, billingCoreMockFns } from '@sim/testing/mocks/billing-core.mock'
import {
  billingUsageGateCacheMock,
  billingUsageGateCacheMockFns,
} from '@sim/testing/mocks/billing-usage-gate-cache.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAttributedBillingRequestEnvelope } from '@/lib/billing/core/billing-attribution'
import { resetMidRunUsageCaches } from '@/lib/billing/core/mid-run-usage'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { BillingLimitError } from '@/lib/mothership/request/go/stream'
import { authorizeLifecycleContinuation, restoreBillingAdmission } from './admission'

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), standing: vi.fn() }))
vi.mock('@/lib/mothership/application/authorize-chat-callback', () => ({
  authorizeCopilotChatCallback: mocks.authorize,
  checkCopilotContinuationBilling: mocks.standing,
}))
vi.mock('@/lib/billing/core/usage-gate-cache', () => billingUsageGateCacheMock)
vi.mock('@/lib/billing/core/billing', () => billingCoreMock)
const { mockGetOrganizationSubscription } = billingCoreMockFns
const { mockCheckExecutionUsageLimits } = billingUsageGateCacheMockFns
const attribution = {
  actorUserId: 'actor',
  workspaceId: 'workspace',
  organizationId: 'original-org',
  billedAccountUserId: 'original-owner',
  billingEntity: { type: 'organization' as const, id: 'original-org' },
  billingPeriod: { start: '2026-09-01T00:00:00.000Z', end: '2099-01-01T00:00:00.000Z' },
  payerSubscription: null,
}
const context = {
  userId: 'actor',
  workspaceId: 'workspace',
  chatId: 'chat',
  runId: 'run',
  billingAttribution: attribution,
}
beforeEach(() => {
  setEnvFlags({ isHosted: true, isBillingEnabled: true })
  mocks.standing.mockResolvedValue({ blocked: false })
  mockCheckExecutionUsageLimits.mockResolvedValue({ isExceeded: false })
  mockGetOrganizationSubscription.mockResolvedValue({
    id: 'sub-org',
    referenceId: 'original-org',
    plan: 'team',
    status: 'active',
    seats: 4,
    periodStart: new Date(attribution.billingPeriod.start),
    periodEnd: new Date(attribution.billingPeriod.end),
  })
  resetMidRunUsageCaches()
})
afterEach(resetEnvFlagsMock)

describe('continuation admission', () => {
  it('restores the exact request identity and original payer without resolving a new payer', () => {
    const original = createAttributedBillingRequestEnvelope(attribution)
    const saved = {
      billingRequestId: original.billingRequestId,
      serializedAttribution: original.serializedAttribution,
    }
    const restored = restoreBillingAdmission(saved, context)
    expect(restored.envelope).toEqual(original)
    expect(restored.attribution).toEqual(attribution)
    expect(() => restoreBillingAdmission(saved, { ...context, userId: 'other' })).toThrow()
    expect(() => restoreBillingAdmission(saved, { ...context, workspaceId: 'other' })).toThrow()
    expect(() => restoreBillingAdmission({}, context)).toThrow()
  })
  it('rechecks access on every leg and only checks original account standing', async () => {
    await authorizeLifecycleContinuation(context)
    await authorizeLifecycleContinuation(context)
    expect(mocks.authorize).toHaveBeenCalledTimes(2)
    expect(mocks.standing).toHaveBeenCalledWith({ kind: 'attributed', attribution })
    mocks.authorize.mockRejectedValueOnce(new Error('membership revoked'))
    await expect(authorizeLifecycleContinuation(context)).rejects.toThrow('membership revoked')
    expect(mocks.standing).toHaveBeenCalledTimes(2)
  })
  it('forwards the saved organization mode and refuses blocked or missing admission', async () => {
    await authorizeLifecycleContinuation({
      ...context,
      workspaceId: undefined,
      organizationId: 'org',
      requestMode: 'agent',
    })
    expect(mocks.authorize).toHaveBeenLastCalledWith(
      expect.objectContaining({ organizationId: 'org', mode: 'agent' })
    )
    mocks.standing.mockResolvedValue({ blocked: true })
    await expect(authorizeLifecycleContinuation(context)).rejects.toThrow('blocked')
    await expect(
      authorizeLifecycleContinuation({ ...context, billingAttribution: undefined })
    ).rejects.toThrow('missing')
  })
  it('refuses a continuation whose original payer has crossed its usage limit', async () => {
    mockCheckExecutionUsageLimits.mockResolvedValue({ isExceeded: true, scope: 'payer' })

    const refusal = authorizeLifecycleContinuation(context)

    await expect(refusal).rejects.toBeInstanceOf(BillingLimitError)
    await expect(refusal).rejects.toMatchObject({ userId: 'actor' })
  })
  it('keeps a blocked account a forbidden refusal without reading spend', async () => {
    mocks.standing.mockResolvedValue({ blocked: true })

    await expect(authorizeLifecycleContinuation(context)).rejects.toThrow('blocked')
    expect(mockCheckExecutionUsageLimits).not.toHaveBeenCalled()
  })
  it('does not read spend for a self-hosted continuation', async () => {
    setEnvFlags({ isHosted: false })

    await authorizeLifecycleContinuation(context)
    expect(mockCheckExecutionUsageLimits).not.toHaveBeenCalled()
  })
  it('continues a leg when spend cannot be read', async () => {
    mockCheckExecutionUsageLimits.mockRejectedValueOnce(new Error('ledger read timed out'))
    await expect(authorizeLifecycleContinuation(context)).resolves.toBeUndefined()

    mockCheckExecutionUsageLimits.mockResolvedValueOnce({
      isExceeded: true,
      reason: 'usage_unavailable',
    })
    await expect(authorizeLifecycleContinuation(context)).resolves.toBeUndefined()
  })
  it('refuses a payer the gate finds blocked as a blocked account, not with the usage card', async () => {
    mockCheckExecutionUsageLimits.mockResolvedValueOnce({
      isExceeded: true,
      reason: 'billing_blocked',
      scope: 'payer',
    })

    const refusal = authorizeLifecycleContinuation(context)

    await expect(refusal).rejects.toBeInstanceOf(OrchestrationError)
    await expect(refusal).rejects.toThrow('blocked')
  })
  it('judges a leg past its admitted period against the payer current period', async () => {
    const ended = {
      ...attribution,
      billingPeriod: {
        start: '2026-07-01T00:00:00.000Z',
        end: '2026-08-01T00:00:00.000Z',
        source: 'stripe' as const,
      },
    }
    mockGetOrganizationSubscription.mockResolvedValue({
      id: 'sub-org',
      referenceId: 'original-org',
      plan: 'team',
      status: 'active',
      seats: 4,
      periodStart: new Date(attribution.billingPeriod.start),
      periodEnd: new Date(attribution.billingPeriod.end),
    })
    mockCheckExecutionUsageLimits.mockImplementation(async (judged: typeof attribution) => ({
      isExceeded: judged.billingPeriod.end === attribution.billingPeriod.end,
      scope: 'payer',
    }))

    await expect(
      authorizeLifecycleContinuation({ ...context, billingAttribution: ended })
    ).rejects.toBeInstanceOf(BillingLimitError)

    resetMidRunUsageCaches()
    mockGetOrganizationSubscription.mockRejectedValue(new Error('subscription read failed'))
    await expect(
      authorizeLifecycleContinuation({ ...context, billingAttribution: ended })
    ).resolves.toBeUndefined()
  })
  it('carries a member cap into the refusal so the card names who can raise it', async () => {
    mockCheckExecutionUsageLimits.mockResolvedValue({ isExceeded: true, scope: 'member' })

    await expect(authorizeLifecycleContinuation(context)).rejects.toMatchObject({
      scope: 'member',
    })
  })
})
