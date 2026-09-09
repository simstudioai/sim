/** @vitest-environment node */
import { db } from '@sim/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  sender: vi.fn(),
  member: vi.fn(),
  permission: vi.fn(),
  abort: vi.fn(),
  status: vi.fn(),
  thread: vi.fn(),
  chat: vi.fn(),
  current: vi.fn(),
  returning: vi.fn(),
}))
vi.mock('@/lib/knowledge/application/slack-search/authorization', () => ({
  requireSlackInstallationPrincipal: vi.fn(),
  authorizeSlackSearchInstallation: mocks.authorize,
}))
vi.mock('@/lib/internal/slack/search-client', () => ({ getSlackSearchSender: mocks.sender }))
vi.mock('@/lib/knowledge/application/slack-search/identity', () => ({
  resolveSlackSearchMember: mocks.member,
  SlackSearchIdentityError: class extends Error {},
}))
vi.mock('@/lib/core/application/organization-authorization', () => ({
  authorizeOrganizationOperation: mocks.permission,
}))
vi.mock('@/lib/knowledge/application/slack-search/chat', () => ({
  slackSearchChatOperation: { id: 'organization.chats.slack' },
  resolveSlackSearchChatRecord: mocks.chat,
}))
vi.mock('@/lib/copilot/request/session/abort', () => ({ abortActiveStream: mocks.abort }))
vi.mock('@/lib/webhooks/slack-agent-api', () => ({ setSlackAgentSessionStatus: mocks.status }))

import {
  slackSearchStopSchema,
  stopSlackSearchThread,
} from '@/lib/knowledge/application/slack-search/stop'

const principal = {
  kind: 'slack_installation',
  credentialId: 'c1',
  credentialVersion: 'v1',
  appId: 'A1',
  teamId: 'T1',
  eventId: 'Ev1',
  receivedAt: new Date(),
} as const
const input = {
  type: 'event_callback',
  api_app_id: 'A1',
  team_id: 'T1',
  event_id: 'Ev1',
  event: {
    type: 'agent_session_stopped',
    channel: 'D1',
    user: 'U1',
    thread_ts: '1800000000.1',
    event_ts: '1800000000.2',
  },
} as const
const installation = {
  id: 'i1',
  organizationId: 'org1',
  teamId: 'T1',
  enabled: true,
  revision: 'r1',
  credentialVersion: 'v1',
}
const job = {
  installationId: 'i1',
  credentialId: 'c1',
  credentialVersion: 'v1',
  revision: 'r1',
  receivedAt: Date.now(),
  message: {
    appId: 'A1',
    teamId: 'T1',
    eventId: 'Ev0',
    channelId: 'D1',
    userId: 'U1',
    messageTs: input.event.thread_ts,
    threadTs: input.event.thread_ts,
    query: 'Question',
    queryTooLong: false,
  },
}
const stop = () => stopSlackSearchThread.execute({ principal, input })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.authorize.mockResolvedValue({ installation, secret: { botToken: 'token' } })
  mocks.sender.mockResolvedValue({ email: 'member@fixture.test' })
  mocks.member.mockResolvedValue('member1')
  mocks.permission.mockResolvedValue({ userId: 'member1' })
  mocks.thread.mockResolvedValue([{ id: 'turn1', payload: job }])
  mocks.chat.mockImplementation(async (_tx, input: { userId: string }) => {
    if (input.userId !== 'member1') throw new Error('identity changed')
    return { id: 'chat1' }
  })
  mocks.current.mockResolvedValue([installation])
  mocks.returning
    .mockReset()
    .mockResolvedValueOnce([{ id: 'thread1' }])
    .mockResolvedValueOnce([{ id: 'running' }, { id: 'pending' }])
  const query = { from: vi.fn(), where: vi.fn(), orderBy: vi.fn(), limit: mocks.thread }
  query.from.mockReturnValue(query)
  query.where.mockReturnValue(query)
  query.orderBy.mockReturnValue(query)
  vi.mocked(db.select).mockReturnValue(query as ReturnType<typeof db.select>)
  const txQuery = {
    from: vi.fn(),
    where: vi.fn(),
    for: vi.fn(),
    set: vi.fn(),
    limit: mocks.current,
    returning: mocks.returning,
  }
  for (const method of [txQuery.from, txQuery.where, txQuery.for, txQuery.set])
    method.mockReturnValue(txQuery)
  const tx = { select: () => txQuery, update: () => txQuery }
  vi.mocked(db.transaction).mockImplementation(async (callback) =>
    callback(tx as Parameters<Parameters<typeof db.transaction>[0]>[0])
  )
})

describe('Slack native Stop', () => {
  it('authorizes the sender and cancels active and pending turns before clearing Slack status', async () => {
    await stop()
    expect(mocks.member).toHaveBeenCalledWith('org1', 'T1', 'U1', 'member@fixture.test')
    expect(mocks.permission).toHaveBeenCalledWith(
      expect.objectContaining({ subjectUserId: 'member1', organizationId: 'org1' }),
      expect.anything(),
      installation
    )
    expect(mocks.abort.mock.calls.map(([id]) => id)).toEqual(['running', 'pending'])
    expect(mocks.status).toHaveBeenCalledWith(
      'token',
      { channel: 'D1', threadTs: input.event.thread_ts },
      'active',
      expect.any(AbortSignal)
    )
  })
  it('rejects a different app or workspace before resolving a member', async () => {
    await expect(
      stopSlackSearchThread.execute({ principal, input: { ...input, team_id: 'OTHER' } })
    ).rejects.toThrow('binding changed')
    expect(mocks.member).not.toHaveBeenCalled()
    expect(db.transaction).not.toHaveBeenCalled()
  })
  it('refuses another Slack sender or a changed Sim identity', async () => {
    mocks.thread.mockResolvedValueOnce([
      { id: 'turn1', payload: { ...job, message: { ...job.message, userId: 'OTHER' } } },
    ])
    await expect(stop()).rejects.toThrow()
    expect(db.transaction).not.toHaveBeenCalled()
    mocks.member.mockResolvedValueOnce('other-member')
    await expect(stop()).rejects.toThrow('identity changed')
    expect(mocks.abort).not.toHaveBeenCalled()
  })
  it('refuses a revoked organization member', async () => {
    mocks.member.mockRejectedValueOnce(new Error('membership revoked'))
    await expect(stop()).rejects.toThrow('membership revoked')
    expect(db.transaction).not.toHaveBeenCalled()
    expect(mocks.abort).not.toHaveBeenCalled()
  })
  it('rechecks the installation inside the cancellation transaction', async () => {
    mocks.current.mockResolvedValueOnce([{ ...installation, revision: 'rotated' }])
    await expect(stop()).rejects.toThrow('binding changed')
    expect(mocks.abort).not.toHaveBeenCalled()
  })
  it('does not cancel later work when the Stop watermark was already applied', async () => {
    mocks.returning.mockReset().mockResolvedValueOnce([])
    await stop()
    expect(mocks.returning).toHaveBeenCalledOnce()
    expect(mocks.abort).not.toHaveBeenCalled()
    expect(mocks.status).not.toHaveBeenCalled()
  })
  it('does not deliver after the installation is disabled', async () => {
    mocks.authorize
      .mockResolvedValueOnce({ installation, secret: { botToken: 'token' } })
      .mockResolvedValueOnce(null)
    await stop()
    expect(mocks.abort).toHaveBeenCalledTimes(2)
    expect(mocks.status).not.toHaveBeenCalled()
  })
  it('only accepts native Stop events bound to a DM thread and event timestamp', () => {
    expect(slackSearchStopSchema.safeParse(input).success).toBe(true)
    expect(
      slackSearchStopSchema.safeParse({ ...input, event: { ...input.event, channel: 'C1' } })
        .success
    ).toBe(false)
    expect(
      slackSearchStopSchema.safeParse({ ...input, event: { ...input.event, event_ts: '' } }).success
    ).toBe(false)
  })
})
