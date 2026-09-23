/** @vitest-environment node */
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAttributedBillingRequestEnvelope } from '@/lib/billing/core/billing-attribution'
import { authorizeLifecycleContinuation, restoreBillingAdmission } from './admission'

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), standing: vi.fn() }))
vi.mock('@/lib/mothership/application/authorize-chat-callback', () => ({
  authorizeCopilotChatCallback: mocks.authorize,
  checkCopilotContinuationBilling: mocks.standing,
}))
const attribution = {
  actorUserId: 'actor',
  workspaceId: 'workspace',
  organizationId: 'original-org',
  billedAccountUserId: 'original-owner',
  billingEntity: { type: 'organization' as const, id: 'original-org' },
  billingPeriod: { start: '2026-09-01T00:00:00.000Z', end: '2026-10-01T00:00:00.000Z' },
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
  vi.clearAllMocks()
  setEnvFlags({ isHosted: true })
  mocks.standing.mockResolvedValue({ blocked: false })
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
})
