/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  billingFlag,
  mockClaim,
  mockSelectRows,
  sendEmailSpy,
  getEmailPreferencesMock,
  renderMock,
  subjectMock,
  isOrgAdminRoleMock,
} = vi.hoisted(() => ({
  billingFlag: { enabled: true },
  mockClaim: vi.fn<[], unknown[]>(() => [{ id: 'u1' }]),
  mockSelectRows: vi.fn<[], unknown[]>(() => []),
  sendEmailSpy: vi.fn(() => Promise.resolve({ success: true })),
  getEmailPreferencesMock: vi.fn(() => Promise.resolve(null as unknown)),
  renderMock: vi.fn(() => Promise.resolve('<html></html>')),
  subjectMock: vi.fn(() => 'Subject'),
  isOrgAdminRoleMock: vi.fn(() => true),
}))

vi.mock('@sim/db', () => {
  const updateBuilder: Record<string, unknown> = {
    set: () => updateBuilder,
    where: () => updateBuilder,
    returning: () => Promise.resolve(mockClaim()),
    // Awaited directly by the re-arm path (no `.returning()`).
    then: (f: (v: unknown) => unknown, r?: (e: unknown) => unknown) =>
      Promise.resolve(undefined).then(f, r),
  }
  const selectBuilder: Record<string, unknown> = {
    from: () => selectBuilder,
    where: () => selectBuilder,
    innerJoin: () => selectBuilder,
    leftJoin: () => selectBuilder,
    limit: () => Promise.resolve(mockSelectRows()),
    // Awaited directly by the org-admins query (no `.limit()`).
    then: (f: (v: unknown) => unknown, r?: (e: unknown) => unknown) =>
      Promise.resolve(mockSelectRows()).then(f, r),
  }
  return { db: { update: () => updateBuilder, select: () => selectBuilder } }
})

vi.mock('@/lib/core/config/env-flags', () => ({
  get isBillingEnabled() {
    return billingFlag.enabled
  },
}))
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

describe('maybeSendLimitThresholdEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    billingFlag.enabled = true
    mockClaim.mockReturnValue([{ id: 'u1' }]) // claim wins by default
    mockSelectRows.mockReturnValue([]) // no settings row / no admins by default
    getEmailPreferencesMock.mockResolvedValue(null)
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

  it('does not send when the atomic claim is lost (already notified)', async () => {
    mockClaim.mockReturnValue([]) // someone else already advanced the threshold
    await maybeSendLimitThresholdEmail({ ...baseUserParams, currentUsage: 4.5, limit: 5 })
    expect(sendEmailSpy).not.toHaveBeenCalled()
  })

  it('does not send in the dead band (70%–80%)', async () => {
    await maybeSendLimitThresholdEmail({ ...baseUserParams, currentUsage: 3.75, limit: 5 })
    expect(mockClaim).not.toHaveBeenCalled()
    expect(sendEmailSpy).not.toHaveBeenCalled()
  })

  it('re-arms below the band without claiming or sending', async () => {
    await maybeSendLimitThresholdEmail({ ...baseUserParams, currentUsage: 1, limit: 5 })
    expect(mockClaim).not.toHaveBeenCalled()
    expect(sendEmailSpy).not.toHaveBeenCalled()
  })

  it('respects the per-user notifications toggle even after winning the claim', async () => {
    mockSelectRows.mockReturnValue([{ enabled: false }])
    await maybeSendLimitThresholdEmail({ ...baseUserParams, currentUsage: 4.5, limit: 5 })
    expect(sendEmailSpy).not.toHaveBeenCalled()
  })

  it('respects unsubscribe preferences', async () => {
    getEmailPreferencesMock.mockResolvedValue({ unsubscribeNotifications: true })
    await maybeSendLimitThresholdEmail({ ...baseUserParams, currentUsage: 4.5, limit: 5 })
    expect(sendEmailSpy).not.toHaveBeenCalled()
  })

  it('skips entirely when billing is disabled', async () => {
    billingFlag.enabled = false
    await maybeSendLimitThresholdEmail({ ...baseUserParams, currentUsage: 5, limit: 5 })
    expect(mockClaim).not.toHaveBeenCalled()
    expect(sendEmailSpy).not.toHaveBeenCalled()
  })

  it('skips when limit or usage is non-positive', async () => {
    await maybeSendLimitThresholdEmail({ ...baseUserParams, currentUsage: 0, limit: 5 })
    await maybeSendLimitThresholdEmail({ ...baseUserParams, currentUsage: 4, limit: 0 })
    expect(sendEmailSpy).not.toHaveBeenCalled()
  })
})
