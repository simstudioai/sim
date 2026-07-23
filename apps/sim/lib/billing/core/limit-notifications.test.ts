/**
 * @vitest-environment node
 */
import {
  dbChainMock,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  resetEnvFlagsMock,
  schemaMock,
  setEnvFlags,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { sendEmailSpy, getEmailPreferencesMock, renderMock, subjectMock, isOrgAdminRoleMock } =
  vi.hoisted(() => ({
    sendEmailSpy: vi.fn(() => Promise.resolve({ success: true })),
    getEmailPreferencesMock: vi.fn(() => Promise.resolve(null as unknown)),
    renderMock: vi.fn(() => Promise.resolve('<html></html>')),
    subjectMock: vi.fn(() => 'Subject'),
    isOrgAdminRoleMock: vi.fn(() => true),
  }))

vi.mock('@sim/db', () => dbChainMock)

vi.mock('@/lib/core/utils/urls', () => ({ getBaseUrl: () => 'https://app.sim.ai' }))
vi.mock('@/lib/messaging/email/mailer', () => ({ sendEmail: sendEmailSpy }))
vi.mock('@/lib/messaging/email/unsubscribe', () => ({
  getEmailPreferences: getEmailPreferencesMock,
}))
vi.mock('@/components/emails/render', () => ({
  renderLimitThresholdEmail: renderMock,
  getLimitEmailSubject: subjectMock,
}))
vi.mock('@sim/platform-authz/workspace', () => ({ isOrgAdminRole: isOrgAdminRoleMock }))

import { maybeSendLimitThresholdEmail } from '@/lib/billing/core/limit-notifications'

const baseUserParams = {
  category: 'storage' as const,
  scope: 'user' as const,
  workspaceId: 'ws-1',
  usageLabel: '4.5 GB',
  limitLabel: '5 GB',
  userId: 'u1',
  userEmail: 'u1@example.com',
  userName: 'Ada',
}

afterAll(resetEnvFlagsMock)

describe('maybeSendLimitThresholdEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    setEnvFlags({ isBillingEnabled: true })
    dbChainMockFns.returning.mockResolvedValue([{ id: 'u1' }])
    getEmailPreferencesMock.mockResolvedValue(null)
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it('sends a warning email when crossing 80% and the claim wins', async () => {
    await maybeSendLimitThresholdEmail({ ...baseUserParams, currentUsage: 4.5, limit: 5 })
    expect(sendEmailSpy).toHaveBeenCalledTimes(1)
    expect(renderMock).toHaveBeenCalledWith(expect.objectContaining({ kind: 'warning' }))
    expect(subjectMock).toHaveBeenCalledWith('storage', 'warning')
  })

  it('sends a reached email at/over 100%', async () => {
    await maybeSendLimitThresholdEmail({ ...baseUserParams, currentUsage: 5, limit: 5 })
    expect(renderMock).toHaveBeenCalledWith(expect.objectContaining({ kind: 'reached' }))
    expect(subjectMock).toHaveBeenCalledWith('storage', 'reached')
  })

  it('never sends in rearmOnly mode, even when usage is above a threshold', async () => {
    await maybeSendLimitThresholdEmail({
      ...baseUserParams,
      currentUsage: 4.5,
      limit: 5,
      rearmOnly: true,
    })
    expect(dbChainMockFns.returning).not.toHaveBeenCalled()
    expect(sendEmailSpy).not.toHaveBeenCalled()
  })

  it('does not send when the atomic claim is lost (already notified)', async () => {
    dbChainMockFns.returning.mockResolvedValue([])
    await maybeSendLimitThresholdEmail({ ...baseUserParams, currentUsage: 4.5, limit: 5 })
    expect(sendEmailSpy).not.toHaveBeenCalled()
  })

  it('claims without re-arming on a crossing (re-arm and claim are mutually exclusive)', async () => {
    await maybeSendLimitThresholdEmail({ ...baseUserParams, currentUsage: 4.5, limit: 5 })
    expect(dbChainMockFns.update).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.returning).toHaveBeenCalledTimes(1)
    expect(sendEmailSpy).toHaveBeenCalledTimes(1)
  })

  it('does not send in the dead band (70%–80%)', async () => {
    await maybeSendLimitThresholdEmail({ ...baseUserParams, currentUsage: 3.75, limit: 5 })
    expect(dbChainMockFns.returning).not.toHaveBeenCalled()
    expect(sendEmailSpy).not.toHaveBeenCalled()
  })

  it('re-arms below the band without claiming or sending', async () => {
    await maybeSendLimitThresholdEmail({ ...baseUserParams, currentUsage: 1, limit: 5 })
    expect(dbChainMockFns.returning).not.toHaveBeenCalled()
    expect(sendEmailSpy).not.toHaveBeenCalled()
  })

  it('does not send OR burn the claim when the per-user toggle is off', async () => {
    queueTableRows(schemaMock.settings, [{ enabled: false }])
    await maybeSendLimitThresholdEmail({ ...baseUserParams, currentUsage: 4.5, limit: 5 })
    expect(sendEmailSpy).not.toHaveBeenCalled()
    expect(dbChainMockFns.returning).not.toHaveBeenCalled()
  })

  it('does not send OR burn the claim when the recipient unsubscribed', async () => {
    getEmailPreferencesMock.mockResolvedValue({ unsubscribeNotifications: true })
    await maybeSendLimitThresholdEmail({ ...baseUserParams, currentUsage: 4.5, limit: 5 })
    expect(sendEmailSpy).not.toHaveBeenCalled()
    expect(dbChainMockFns.returning).not.toHaveBeenCalled()
  })

  it('skips entirely when billing is disabled', async () => {
    setEnvFlags({ isBillingEnabled: false })
    await maybeSendLimitThresholdEmail({ ...baseUserParams, currentUsage: 5, limit: 5 })
    expect(dbChainMockFns.returning).not.toHaveBeenCalled()
    expect(sendEmailSpy).not.toHaveBeenCalled()
  })

  it('re-arms but does not send when usage is fully cleared (zero usage)', async () => {
    await maybeSendLimitThresholdEmail({ ...baseUserParams, currentUsage: 0, limit: 5 })
    expect(dbChainMockFns.update).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.returning).not.toHaveBeenCalled()
    expect(sendEmailSpy).not.toHaveBeenCalled()
  })

  it('skips when the limit is non-positive', async () => {
    await maybeSendLimitThresholdEmail({ ...baseUserParams, currentUsage: 4, limit: 0 })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(sendEmailSpy).not.toHaveBeenCalled()
  })
})
