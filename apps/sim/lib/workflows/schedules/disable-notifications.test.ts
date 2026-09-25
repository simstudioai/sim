import {
  queueTableRows,
  resetDbChainMock,
  resetUrlsMock,
  schemaMock,
  urlsMockFns,
} from '@sim/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { sendEmailSpy, renderMock, subjectMock, getUsersWithPermissionsMock } = vi.hoisted(() => ({
  sendEmailSpy: vi.fn(() => Promise.resolve({ success: true })),
  renderMock: vi.fn(() => Promise.resolve('<html></html>')),
  subjectMock: vi.fn(() => 'A schedule was turned off'),
  getUsersWithPermissionsMock: vi.fn(() => Promise.resolve([] as unknown[])),
}))

vi.mock('@/lib/messaging/email/mailer', () => ({ sendEmail: sendEmailSpy }))
vi.mock('@/components/emails', () => ({
  renderScheduleDisabledEmail: renderMock,
  getEmailSubject: subjectMock,
}))
vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUsersWithPermissions: getUsersWithPermissionsMock,
}))

import { notifyScheduleAutoDisabled } from '@/lib/workflows/schedules/disable-notifications'

const WORKFLOW_SCHEDULE_ROW = {
  sourceType: 'workflow',
  jobTitle: null,
  failedCount: 100,
  sourceUserId: null,
  sourceWorkspaceId: null,
  workflowId: 'wf-1',
  workflowName: 'Daily digest',
  workflowUserId: 'creator-1',
  workflowWorkspaceId: 'ws-1',
}

const CREATOR = { email: 'creator@example.com', name: 'Ada' }

function admin(email: string, name = 'Admin') {
  return { userId: `u-${email}`, email, name, permissionType: 'admin' }
}

beforeAll(() => {
  urlsMockFns.mockGetBaseUrl.mockReturnValue('https://app.sim.ai')
})

afterAll(() => {
  resetDbChainMock()
  resetUrlsMock()
})

describe('notifyScheduleAutoDisabled', () => {
  beforeEach(() => {
    resetDbChainMock()
    getUsersWithPermissionsMock.mockResolvedValue([])
  })

  it('emails the creator and the workspace admins, one send per address', async () => {
    queueTableRows(schemaMock.workflowSchedule, [WORKFLOW_SCHEDULE_ROW])
    queueTableRows(schemaMock.user, [CREATOR])
    getUsersWithPermissionsMock.mockResolvedValue([
      admin('admin-a@example.com'),
      admin('admin-b@example.com'),
    ])

    await notifyScheduleAutoDisabled({ scheduleId: 's-1', reason: 'consecutive_failures' })

    expect(sendEmailSpy).toHaveBeenCalledTimes(3)
    for (const call of sendEmailSpy.mock.calls) {
      // Never a `to` array — prepare.ts only checks to[0] for unsubscribe.
      expect(typeof (call[0] as { to: unknown }).to).toBe('string')
      expect(call[0]).toMatchObject({ emailType: 'notifications' })
    }
  })

  it('sends once when the creator is also a workspace admin', async () => {
    queueTableRows(schemaMock.workflowSchedule, [WORKFLOW_SCHEDULE_ROW])
    queueTableRows(schemaMock.user, [CREATOR])
    getUsersWithPermissionsMock.mockResolvedValue([admin('CREATOR@example.com')])

    await notifyScheduleAutoDisabled({ scheduleId: 's-1', reason: 'consecutive_failures' })

    expect(sendEmailSpy).toHaveBeenCalledTimes(1)
  })

  it('sends nothing when the workflow row is gone (404 disable)', async () => {
    queueTableRows(schemaMock.workflowSchedule, [
      {
        ...WORKFLOW_SCHEDULE_ROW,
        workflowName: null,
        workflowUserId: null,
        workflowWorkspaceId: null,
      },
    ])

    await notifyScheduleAutoDisabled({ scheduleId: 's-1', reason: 'workflow_not_found' })

    expect(sendEmailSpy).not.toHaveBeenCalled()
  })

  it('caps the fan-out at 20 recipients', async () => {
    queueTableRows(schemaMock.workflowSchedule, [WORKFLOW_SCHEDULE_ROW])
    queueTableRows(schemaMock.user, [CREATOR])
    getUsersWithPermissionsMock.mockResolvedValue(
      Array.from({ length: 40 }, (_, i) => admin(`admin-${i}@example.com`))
    )

    await notifyScheduleAutoDisabled({ scheduleId: 's-1', reason: 'consecutive_failures' })

    expect(sendEmailSpy).toHaveBeenCalledTimes(20)
    expect(sendEmailSpy).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'creator@example.com' })
    )
  })

  it('keeps sending after one recipient fails', async () => {
    queueTableRows(schemaMock.workflowSchedule, [WORKFLOW_SCHEDULE_ROW])
    queueTableRows(schemaMock.user, [CREATOR])
    getUsersWithPermissionsMock.mockResolvedValue([admin('admin-a@example.com')])
    sendEmailSpy.mockRejectedValueOnce(new Error('smtp down'))

    await notifyScheduleAutoDisabled({ scheduleId: 's-1', reason: 'consecutive_failures' })

    expect(sendEmailSpy).toHaveBeenCalledTimes(2)
  })

  it('still emails the creator when the admin lookup fails', async () => {
    queueTableRows(schemaMock.workflowSchedule, [WORKFLOW_SCHEDULE_ROW])
    queueTableRows(schemaMock.user, [CREATOR])
    getUsersWithPermissionsMock.mockRejectedValue(new Error('db down'))

    await expect(
      notifyScheduleAutoDisabled({ scheduleId: 's-1', reason: 'consecutive_failures' })
    ).resolves.toBeUndefined()

    expect(sendEmailSpy).toHaveBeenCalledTimes(1)
    expect(sendEmailSpy).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'creator@example.com' })
    )
  })
})
