/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  billingFlag,
  mockClaim,
  mockSelectRows,
  dbUpdateSpy,
  sendEmailSpy,
  getEmailPreferencesMock,
  renderMock,
  subjectMock,
  isOrgAdminRoleMock,
} = vi.hoisted(() => ({
  billingFlag: { enabled: true },
  mockClaim: vi.fn<[], unknown[]>(() => [{ id: 'u1' }]),
  mockSelectRows: vi.fn<[], unknown[]>(() => []),
  dbUpdateSpy: vi.fn(),
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
  dbUpdateSpy.mockImplementation(() => updateBuilder)
  return { db: { update: dbUpdateSpy, select: () => selectBuilder } }
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

  it('never sends in rearmOnly mode, even when usage is above a threshold', async () => {
    // A storage shrink that still leaves usage at 90% must only re-arm, not send,
    // even if the stored threshold is 0 (claim would otherwise win).
    await maybeSendLimitThresholdEmail({
      ...baseUserParams,
      currentUsage: 4.5,
      limit: 5,
      rearmOnly: true,
    })
    expect(mockClaim).not.toHaveBeenCalled()
    expect(sendEmailSpy).not.toHaveBeenCalled()
  })

  it('does not send when the atomic claim is lost (already notified)', async () => {
    mockClaim.mockReturnValue([]) // someone else already advanced the threshold
    await maybeSendLimitThresholdEmail({ ...baseUserParams, currentUsage: 4.5, limit: 5 })
    expect(sendEmailSpy).not.toHaveBeenCalled()
  })

  it('re-arms then claims when a single jump crosses from below the band past 80% (priorUsage)', async () => {
    // prior 50% (re-arm band) → current 90%: re-arm (update) + claim (update) = 2 updates, then send.
    await maybeSendLimitThresholdEmail({
      ...baseUserParams,
      currentUsage: 4.5,
      limit: 5,
      priorUsage: 2.5,
    })
    expect(dbUpdateSpy).toHaveBeenCalledTimes(2)
    expect(sendEmailSpy).toHaveBeenCalledTimes(1)
    expect(renderMock).toHaveBeenCalledWith(expect.objectContaining({ kind: 'warning' }))
  })

  it('does not re-arm when prior usage was already in-band (no spurious reset)', async () => {
    // prior 85% and current 90%: both >= re-arm band → claim only, no re-arm update.
    await maybeSendLimitThresholdEmail({
      ...baseUserParams,
      currentUsage: 4.5,
      limit: 5,
      priorUsage: 4.25,
    })
    expect(dbUpdateSpy).toHaveBeenCalledTimes(1)
    expect(sendEmailSpy).toHaveBeenCalledTimes(1)
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

  it('does not send OR burn the claim when the per-user toggle is off', async () => {
    mockSelectRows.mockReturnValue([{ enabled: false }])
    await maybeSendLimitThresholdEmail({ ...baseUserParams, currentUsage: 4.5, limit: 5 })
    expect(sendEmailSpy).not.toHaveBeenCalled()
    // Recipient resolution gates the claim, so the threshold isn't advanced —
    // re-enabling notifications later still lets the email fire.
    expect(mockClaim).not.toHaveBeenCalled()
  })

  it('does not send OR burn the claim when the recipient unsubscribed', async () => {
    getEmailPreferencesMock.mockResolvedValue({ unsubscribeNotifications: true })
    await maybeSendLimitThresholdEmail({ ...baseUserParams, currentUsage: 4.5, limit: 5 })
    expect(sendEmailSpy).not.toHaveBeenCalled()
    expect(mockClaim).not.toHaveBeenCalled()
  })

  it('skips entirely when billing is disabled', async () => {
    billingFlag.enabled = false
    await maybeSendLimitThresholdEmail({ ...baseUserParams, currentUsage: 5, limit: 5 })
    expect(mockClaim).not.toHaveBeenCalled()
    expect(sendEmailSpy).not.toHaveBeenCalled()
  })

  it('re-arms but does not send when usage is fully cleared (zero usage)', async () => {
    await maybeSendLimitThresholdEmail({ ...baseUserParams, currentUsage: 0, limit: 5 })
    expect(dbUpdateSpy).toHaveBeenCalledTimes(1) // re-arm only
    expect(mockClaim).not.toHaveBeenCalled()
    expect(sendEmailSpy).not.toHaveBeenCalled()
  })

  it('re-arms then sends on wipe-then-rebuild (priorUsage 0)', async () => {
    // prior 0% (empty table) → current 90%: re-arm + claim + send.
    await maybeSendLimitThresholdEmail({
      ...baseUserParams,
      currentUsage: 4.5,
      limit: 5,
      priorUsage: 0,
    })
    expect(dbUpdateSpy).toHaveBeenCalledTimes(2)
    expect(sendEmailSpy).toHaveBeenCalledTimes(1)
  })

  it('skips when the limit is non-positive', async () => {
    await maybeSendLimitThresholdEmail({ ...baseUserParams, currentUsage: 4, limit: 0 })
    expect(dbUpdateSpy).not.toHaveBeenCalled()
    expect(sendEmailSpy).not.toHaveBeenCalled()
  })
})
