import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing/mocks/database.mock'
import { emailMailerMock, emailMailerMockFns } from '@sim/testing/mocks/email-mailer.mock'
import { emailTemplatesMock, emailTemplatesMockFns } from '@sim/testing/mocks/email-templates.mock'
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import { schemaMock } from '@sim/testing/mocks/schema.mock'
import { resetUrlsMock, urlsMockFns } from '@sim/testing/mocks/urls.mock'
import { workspaceAuthzMock } from '@sim/testing/mocks/workspace-authz.mock'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { getEmailPreferencesMock } = vi.hoisted(() => ({
  getEmailPreferencesMock: vi.fn(() => Promise.resolve(null as unknown)),
}))

vi.mock('@/lib/messaging/email/mailer', () => emailMailerMock)
vi.mock('@/lib/messaging/email/unsubscribe', () => ({
  getEmailPreferences: getEmailPreferencesMock,
}))
vi.mock('@/components/emails', () => emailTemplatesMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

import { maybeSendLimitThresholdEmail } from '@/lib/billing/core/limit-notifications'

const sendEmailSpy = emailMailerMockFns.mockSendEmail
const renderMock = emailTemplatesMockFns.mockRenderLimitThresholdEmail
const subjectMock = emailTemplatesMockFns.mockGetLimitEmailSubject
sendEmailSpy.mockResolvedValue({ success: true })
renderMock.mockResolvedValue('<html></html>')
subjectMock.mockReturnValue('Subject')

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

beforeAll(() => {
  urlsMockFns.mockGetBaseUrl.mockReturnValue('https://app.sim.ai')
})

afterAll(() => {
  resetEnvFlagsMock()
  resetUrlsMock()
})

describe('maybeSendLimitThresholdEmail', () => {
  beforeEach(() => {
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
    // Pins the subject to the shared helper's return, so a sender that builds
    // its own string — or a mock aimed at the wrong module path — fails here.
    expect(sendEmailSpy).toHaveBeenCalledWith(expect.objectContaining({ subject: 'Subject' }))
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

  it('re-arms but does not send when usage is fully cleared (zero usage)', async () => {
    await maybeSendLimitThresholdEmail({ ...baseUserParams, currentUsage: 0, limit: 5 })
    expect(dbChainMockFns.update).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.returning).not.toHaveBeenCalled()
    expect(sendEmailSpy).not.toHaveBeenCalled()
  })
})
