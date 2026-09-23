/**
 * @vitest-environment node
 */
import { db } from '@sim/db'
import { member, outboxEvent, permissionAccessRequest, user, workspace } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OutboxEventContext } from '@/lib/core/outbox/service'

const { mockRender, mockSend, mockHasEmailService, mockMembership, mockEnabled } = vi.hoisted(
  () => ({
    mockRender: vi.fn(),
    mockSend: vi.fn(),
    mockHasEmailService: vi.fn(),
    mockMembership: vi.fn(),
    mockEnabled: vi.fn(),
  })
)

vi.mock('@/components/emails/render', () => ({
  renderPermissionAccessRequestEmail: mockRender,
}))
vi.mock('@/components/emails/subjects', () => ({ getEmailSubject: (kind: string) => kind }))
vi.mock('@/lib/messaging/email/mailer', () => ({
  sendEmail: mockSend,
  hasEmailService: mockHasEmailService,
}))
vi.mock('@/ee/access-requests/lib/application/authorization', () => ({
  loadAccessRequestMembership: mockMembership,
}))
vi.mock('@/lib/core/utils/urls', () => ({ getBaseUrl: () => 'https://sim.example' }))
vi.mock('@/ee/access-requests/lib/settings', () => ({
  isAccessRequestEnabled: mockEnabled,
}))

import {
  PERMISSION_ACCESS_REQUEST_CREATED_EVENT,
  PERMISSION_ACCESS_REQUEST_DECIDED_EVENT,
} from '@/ee/access-requests/lib/notification-events'
import { permissionAccessRequestOutboxHandlers } from '@/ee/access-requests/lib/notifications'

const request = {
  id: 'request-one',
  requesterId: 'requester-one',
  organizationId: 'organization-one',
  workspaceId: 'workspace-one',
  status: 'pending',
  membershipId: '[null,"grant-one"]',
}
const adminEvent = 'permission-access-request.notify-admin'
const createdHandler =
  permissionAccessRequestOutboxHandlers[PERMISSION_ACCESS_REQUEST_CREATED_EVENT]
const decidedHandler =
  permissionAccessRequestOutboxHandlers[PERMISSION_ACCESS_REQUEST_DECIDED_EVENT]
const adminHandler = permissionAccessRequestOutboxHandlers[adminEvent]

function context(): OutboxEventContext {
  return {
    eventId: 'event-one',
    eventType: PERMISSION_ACCESS_REQUEST_CREATED_EVENT,
    attempts: 0,
    maxAttempts: 10,
    signal: new AbortController().signal,
    checkpointPayload: vi.fn().mockResolvedValue(undefined),
  }
}

function queueWorkspaceRequest(overrides: Partial<typeof request> = {}) {
  queueTableRows(permissionAccessRequest, [{ ...request, ...overrides }])
  queueTableRows(workspace, [{ organizationId: request.organizationId }])
}

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  mockRender.mockResolvedValue('<html>Authenticated request link</html>')
  mockSend.mockResolvedValue({ success: true })
  mockHasEmailService.mockReturnValue(true)
  mockMembership.mockResolvedValue({ role: 'read', membershipId: request.membershipId })
  mockEnabled.mockResolvedValue(true)
})

describe('access request administrator notifications', () => {
  it('bounds fan-out to one page and checkpoints durable progress', async () => {
    queueWorkspaceRequest()
    const recipients = Array.from({ length: 50 }, (_, index) => ({
      id: `member-${index}`,
      userId: `admin-${index}`,
    }))
    queueTableRows(member, recipients)
    const eventContext = context()

    const result = await createdHandler({ requestId: request.id }, eventContext)

    expect(dbChainMockFns.limit).toHaveBeenCalledWith(50)
    expect(dbChainMockFns.insert).toHaveBeenCalledExactlyOnceWith(outboxEvent)
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      recipients.map((recipient) => ({
        id: `${adminEvent}:${request.id}:${recipient.userId}`,
        eventType: adminEvent,
        payload: { requestId: request.id, recipientUserId: recipient.userId },
      }))
    )
    expect(dbChainMockFns.onConflictDoNothing).toHaveBeenCalledWith({ target: outboxEvent.id })
    expect(eventContext.checkpointPayload).toHaveBeenCalledWith({ afterMemberId: 'member-49' })
    expect(result).toMatchObject({ outcome: 'deferred', consumeAttempt: false })
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('resumes after the saved member cursor and terminates after a partial page', async () => {
    queueWorkspaceRequest()
    queueTableRows(member, [{ id: 'member-60', userId: 'admin-60' }])

    await expect(
      createdHandler({ requestId: request.id, afterMemberId: 'member-59' }, context())
    ).resolves.toBeUndefined()

    expect(dbChainMockFns.where).toHaveBeenCalledWith(
      expect.objectContaining({
        conditions: expect.arrayContaining([{ type: 'gt', left: member.id, right: 'member-59' }]),
      })
    )
  })

  it('reuses child event IDs when a crash interrupts checkpointing', async () => {
    const failedContext = context()
    vi.mocked(failedContext.checkpointPayload).mockRejectedValueOnce(new Error('lease lost'))
    queueWorkspaceRequest()
    queueTableRows(member, [{ id: 'member-one', userId: 'admin-one' }])

    await expect(createdHandler({ requestId: request.id }, failedContext)).rejects.toThrow(
      'lease lost'
    )

    queueWorkspaceRequest()
    queueTableRows(member, [{ id: 'member-one', userId: 'admin-one' }])
    await createdHandler({ requestId: request.id }, context())

    expect(dbChainMockFns.values.mock.calls[0][0]).toEqual(dbChainMockFns.values.mock.calls[1][0])
    expect(dbChainMockFns.onConflictDoNothing).toHaveBeenCalledTimes(2)
  })

  it('skips fan-out when email is not configured', async () => {
    queueWorkspaceRequest()
    mockHasEmailService.mockReturnValue(false)

    await createdHandler({ requestId: request.id }, context())

    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('does not email a former administrator', async () => {
    queueWorkspaceRequest()
    queueTableRows(user, [{ email: 'former-admin@example.com' }])
    queueTableRows(member, [])

    await adminHandler({ requestId: request.id, recipientUserId: 'former-admin' }, context())

    expect(mockSend).not.toHaveBeenCalled()
    expect(dbChainMockFns.where).toHaveBeenCalledWith(
      expect.objectContaining({
        conditions: expect.arrayContaining([
          { type: 'eq', left: member.userId, right: 'former-admin' },
          { type: 'eq', left: member.organizationId, right: request.organizationId },
          { type: 'inArray', column: member.role, values: ['admin', 'owner'] },
        ]),
      })
    )
  })

  it('emails an eligible administrator after a temporary ban has expired', async () => {
    queueWorkspaceRequest()
    queueTableRows(user, [
      {
        email: 'admin@example.com',
        banned: true,
        banExpires: new Date('2020-01-01'),
        suspendedAt: null,
      },
    ])
    queueTableRows(member, [{ id: 'admin-member' }])

    await adminHandler({ requestId: request.id, recipientUserId: 'admin-one' }, context())

    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ to: 'admin@example.com' }))
  })

  it.each([
    { banned: true, banExpires: null, suspendedAt: null },
    { banned: true, banExpires: new Date('2099-01-01'), suspendedAt: null },
    { banned: false, banExpires: null, suspendedAt: new Date() },
  ])('does not email a recipient whose account is currently blocked', async (account) => {
    queueWorkspaceRequest()
    queueTableRows(user, [{ email: 'admin@example.com', ...account }])

    await adminHandler({ requestId: request.id, recipientUserId: 'admin-one' }, context())

    expect(mockSend).not.toHaveBeenCalled()
  })

  it('skips pending-request emails after the organization disables requests', async () => {
    queueWorkspaceRequest()
    mockEnabled.mockResolvedValue(false)

    await adminHandler({ requestId: request.id, recipientUserId: 'admin-one' }, context())

    expect(mockSend).not.toHaveBeenCalled()
  })

  it('builds an authenticated review link and loads the current administrator email', async () => {
    queueWorkspaceRequest()
    queueTableRows(user, [{ email: 'current-admin@example.com' }])
    queueTableRows(member, [{ id: 'member-one' }])

    await adminHandler({ requestId: request.id, recipientUserId: 'admin-one' }, context())

    expect(mockRender).toHaveBeenCalledExactlyOnceWith({
      kind: 'created',
      requestLink:
        'https://sim.example/access-requests?organizationId=organization-one&view=review&request-id=request-one',
    })
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'current-admin@example.com', emailType: 'transactional' })
    )
  })

  it('discards stale creation notifications after a request is resolved', async () => {
    queueTableRows(permissionAccessRequest, [{ ...request, status: 'fulfilled' }])

    await adminHandler({ requestId: request.id, recipientUserId: 'admin-one' }, context())

    expect(mockSend).not.toHaveBeenCalled()
  })

  it('fails delivery for retry without mutating request state', async () => {
    queueWorkspaceRequest()
    queueTableRows(user, [{ email: 'admin@example.com' }])
    queueTableRows(member, [{ id: 'member-one' }])
    mockSend.mockResolvedValueOnce({ success: false })

    await expect(
      adminHandler({ requestId: request.id, recipientUserId: 'admin-one' }, context())
    ).rejects.toThrow('Failed to send access request notification')

    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })

  it('refuses a caller-provided destination or URL in the durable payload', async () => {
    await expect(
      adminHandler(
        { requestId: request.id, recipientUserId: 'admin-one', email: 'attacker@example.com' },
        context()
      )
    ).rejects.toThrow()
    expect(mockSend).not.toHaveBeenCalled()
  })
})

describe('access request requester notifications', () => {
  it.each(['fulfilled', 'declined', 'cancelled', 'closed'])(
    'notifies the requester for %s without putting private request details in email',
    async (status) => {
      queueWorkspaceRequest({ status })
      queueTableRows(user, [{ email: 'requester@example.com' }])

      await decidedHandler({ requestId: request.id }, context())

      expect(mockRender).toHaveBeenCalledExactlyOnceWith({
        kind: 'decided',
        requestLink:
          'https://sim.example/workspace/workspace-one/settings/requests?view=requests&requestId=request-one',
      })
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'requester@example.com', emailType: 'transactional' })
      )
    }
  )

  it('supports an external workspace member without organization membership', async () => {
    queueWorkspaceRequest({ status: 'fulfilled' })
    queueTableRows(user, [{ email: 'external@example.com' }])

    await decidedHandler({ requestId: request.id }, context())

    expect(mockMembership).toHaveBeenCalledWith(
      db,
      request.requesterId,
      { kind: 'workspace', workspaceId: request.workspaceId },
      request.organizationId
    )
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ to: 'external@example.com' }))
    expect(mockRender).toHaveBeenCalledExactlyOnceWith({
      kind: 'decided',
      requestLink:
        'https://sim.example/workspace/workspace-one/settings/requests?view=requests&requestId=request-one',
    })
  })

  it('encodes a canonical workspace identifier as one path segment', async () => {
    queueWorkspaceRequest({ status: 'fulfilled', workspaceId: 'workspace/with?characters' })
    queueTableRows(user, [{ email: 'requester@example.com' }])

    await decidedHandler({ requestId: request.id }, context())

    expect(mockRender).toHaveBeenCalledExactlyOnceWith({
      kind: 'decided',
      requestLink:
        'https://sim.example/workspace/workspace%2Fwith%3Fcharacters/settings/requests?view=requests&requestId=request-one',
    })
  })

  it('skips delivery after the requester loses workspace access', async () => {
    queueWorkspaceRequest({ status: 'fulfilled' })
    mockMembership.mockResolvedValueOnce(null)

    await decidedHandler({ requestId: request.id }, context())

    expect(mockSend).not.toHaveBeenCalled()
  })

  it('skips delivery after the workspace moves to another organization', async () => {
    queueTableRows(permissionAccessRequest, [{ ...request, status: 'closed' }])
    queueTableRows(workspace, [{ organizationId: 'other-organization' }])

    await decidedHandler({ requestId: request.id }, context())

    expect(mockMembership).not.toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('requires current organization membership for an organization-scoped request', async () => {
    queueTableRows(permissionAccessRequest, [{ ...request, workspaceId: null, status: 'declined' }])
    mockMembership.mockResolvedValueOnce(null)

    await decidedHandler({ requestId: request.id }, context())

    expect(mockSend).not.toHaveBeenCalled()
  })

  it('links organization-scoped decisions to the requester history', async () => {
    queueTableRows(permissionAccessRequest, [
      { ...request, workspaceId: null, status: 'fulfilled' },
    ])
    queueTableRows(user, [{ email: 'requester@example.com' }])

    await decidedHandler({ requestId: request.id }, context())

    expect(mockRender).toHaveBeenCalledWith({
      kind: 'decided',
      requestLink:
        'https://sim.example/access-requests?view=requests&requestId=request-one&organizationId=organization-one',
    })
  })

  it('stops before email delivery when its outbox lease has expired', async () => {
    queueWorkspaceRequest({ status: 'fulfilled' })
    queueTableRows(user, [{ email: 'requester@example.com' }])
    const eventContext = context()
    eventContext.signal = AbortSignal.abort(new Error('lease expired'))

    await expect(decidedHandler({ requestId: request.id }, eventContext)).rejects.toThrow(
      'lease expired'
    )
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('does not revive an old notification after the requester is removed and reinvited', async () => {
    queueWorkspaceRequest({ status: 'fulfilled' })
    mockMembership.mockResolvedValueOnce({ role: 'read', membershipId: '[null,"new-grant"]' })

    await decidedHandler({ requestId: request.id }, context())

    expect(mockSend).not.toHaveBeenCalled()
  })

  it('delivers existing decisions after the organization disables new requests', async () => {
    queueWorkspaceRequest({ status: 'declined' })
    queueTableRows(user, [{ email: 'requester@example.com' }])
    mockEnabled.mockResolvedValue(false)

    await decidedHandler({ requestId: request.id }, context())

    expect(mockSend).toHaveBeenCalledOnce()
    expect(mockEnabled).not.toHaveBeenCalled()
  })
})
