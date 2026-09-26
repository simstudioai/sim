import { db } from '@sim/db'
import {
  createPersonalApiKeyPrincipal,
  createSessionPrincipal,
} from '@sim/testing/factories/principal.factory'
import {
  organizationAuthorizationMock,
  organizationAuthorizationMockFns,
} from '@sim/testing/mocks/organization-authorization.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  state: vi.fn(),
  store: vi.fn(),
  authorize: vi.fn(),
  sender: vi.fn(),
  member: vi.fn(),
  persist: vi.fn(),
  dispatch: vi.fn(),
  post: vi.fn(),
  api: vi.fn(),
  lease: vi.fn(),
  outcome: vi.fn(),
  limit: vi.fn(),
}))
vi.mock('@/lib/slack-search/onboarding-state', () => ({
  readSlackSearchOnboardingState: m.state,
  storeSlackSearchOnboardingState: m.store,
}))
vi.mock('@/lib/slack-search/onboarding', () => ({
  SLACK_SEARCH_CONNECT_ACCOUNT: 'Create or connect your Sim account',
  SLACK_SEARCH_CONNECT_SOURCES: 'Connect your sources',
  slackSearchOnboardingUrl: (token: string) => `https://sim.test/slack-search/connect/${token}`,
}))
vi.mock('@/lib/knowledge/application/slack-search/authorization', () => ({
  authorizeSlackSearchInstallation: m.authorize,
}))
vi.mock('@/lib/internal/slack/search-client', () => ({ getSlackSearchSender: m.sender }))
vi.mock('@/lib/internal/slack/client', () => ({
  postSlackMessage: m.post,
  requestSlackApi: m.api,
  slackString: (data: Record<string, unknown>, key: string) =>
    typeof data[key] === 'string' ? data[key] : undefined,
}))
vi.mock('@/lib/knowledge/application/slack-search/identity', () => ({
  resolveSlackSearchMember: m.member,
  SlackSearchIdentityError: class extends Error {
    constructor(readonly reason = 'account_required') {
      super(reason)
    }
  },
}))
vi.mock('@/lib/core/application/organization-authorization', () => organizationAuthorizationMock)
vi.mock('@/lib/knowledge/application/slack-search/turns', () => ({
  persistSlackSearchTurn: m.persist,
  requireSlackSearchTurnLease: m.lease,
}))
vi.mock('@/lib/knowledge/application/slack-search/outbox', () => ({
  dispatchSlackSearchTurn: m.dispatch,
}))
vi.mock('@/lib/knowledge/application/slack-search/repository', () => ({
  recordSlackSearchOutcome: m.outcome,
}))

import {
  getSlackSearchOnboarding,
  retrySlackSearchOnboarding,
  sendSlackSearchOnboarding,
} from '@/lib/knowledge/application/slack-search/onboarding'
import {
  slackSearchConversation,
  slackSearchConversationKey,
} from '@/lib/slack-search/conversation'
import type { SlackSearchMessage } from '@/lib/slack-search/types'

const principal = createSessionPrincipal({ userId: 'user1', sessionId: 'session1' })
const job = {
  installationId: 'install1',
  revision: 'revision1',
  credentialId: 'credential1',
  credentialVersion: 'version1',
  receivedAt: Date.now(),
  message: {
    appId: 'A1',
    teamId: 'T1',
    eventId: 'Ev1',
    channelId: 'D1',
    userId: 'U1',
    messageTs: '1800000000.000002',
    threadTs: '1800000000.000001',
    query: 'Original private question',
    queryTooLong: false,
  },
}
const state = {
  turnId: 'turn1',
  email: 'alice@example.com',
  slackUrl: 'https://sim.slack.com/archives/D1/p1800000000000001',
  createdAt: Date.now(),
}
const context = {
  installation: { id: 'install1', organizationId: 'org1' },
  secret: { botToken: 'bot-secret' },
}
const viewer = { email: 'ALICE@example.com', emailVerified: true }
const conversationKey = slackSearchConversationKey(
  job.installationId,
  job.message.channelId,
  job.message.threadTs
)
const turn = { id: 'turn1', conversationKey, status: 'completed', payload: job }
const thread = {
  id: 'chat1',
  organizationId: 'org1',
  userId: 'user1',
  type: 'mothership',
  deletedAt: null,
  externalConversationKey: conversationKey,
  externalConversationMetadata: slackSearchConversation(job),
}
function queueContext(retried: { id: string }[] = []) {
  m.limit
    .mockResolvedValueOnce([viewer])
    .mockResolvedValueOnce([turn])
    .mockResolvedValueOnce([thread])
    .mockResolvedValueOnce(retried)
}
const get = () => getSlackSearchOnboarding.execute({ principal, input: { token: 'token' } })
const retry = () => retrySlackSearchOnboarding.execute({ principal, input: { token: 'token' } })
beforeEach(() => {
  for (const mock of Object.values(m)) mock.mockReset()
  const query = { from: vi.fn(), where: vi.fn(), limit: m.limit }
  query.from.mockReturnValue(query)
  query.where.mockReturnValue(query)
  vi.mocked(db.select).mockReturnValue(query as ReturnType<typeof db.select>)
  m.state.mockResolvedValue(state)
  m.store.mockResolvedValue('opaque-token')
  m.authorize.mockResolvedValue(context)
  m.sender.mockResolvedValue({ email: state.email })
  m.member.mockResolvedValue('user1')
  organizationAuthorizationMockFns.mockAuthorizeOrganizationOperation.mockResolvedValue({
    role: 'member',
  })
  m.persist.mockResolvedValue('retry1')
  m.api.mockResolvedValue({ status: 200, data: { ok: true, permalink: state.slackUrl } })
  m.post.mockResolvedValue({ status: 200, data: { ok: true } })
})
describe('Slack onboarding authorization and retry', () => {
  it('rejects API keys before reading link state', async () => {
    await expect(
      getSlackSearchOnboarding.execute({
        principal: createPersonalApiKeyPrincipal({ userId: 'user1', keyId: 'key1' }),
        input: { token: 'token' },
      })
    ).rejects.toThrow()
    expect(m.state).not.toHaveBeenCalled()
  })
  it('conceals the organization and question from a different signed-in account', async () => {
    m.limit.mockResolvedValueOnce([{ email: 'different@example.com', emailVerified: true }])
    expect(await get()).toEqual({ status: 'wrong_account' })
    expect(m.authorize).not.toHaveBeenCalled()
    expect(m.member).not.toHaveBeenCalled()
  })
  it('requires email verification before resolving the organization', async () => {
    m.limit.mockResolvedValueOnce([{ ...viewer, emailVerified: false }])
    expect(await get()).toEqual({ status: 'verify_email' })
    expect(m.authorize).not.toHaveBeenCalled()
  })
  it('refuses a changed Slack email or conflicting identity', async () => {
    queueContext()
    m.sender.mockResolvedValueOnce({ email: 'changed@example.com' })
    expect(await get()).toEqual({ status: 'identity_conflict' })
    expect(m.member).not.toHaveBeenCalled()
  })
  it('invalidates links after disable or revision changes', async () => {
    queueContext()
    m.authorize.mockResolvedValueOnce(null)
    await expect(get()).rejects.toThrow('disabled')
    expect(m.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ credentialVersion: 'version1', appId: 'A1', teamId: 'T1' }),
      expect.objectContaining({ installationId: 'install1', revision: 'revision1' })
    )
    expect(m.persist).not.toHaveBeenCalled()
  })
  it('rechecks current capability permissions instead of trusting the link', async () => {
    queueContext()
    organizationAuthorizationMockFns.mockAuthorizeOrganizationOperation.mockRejectedValueOnce(
      new Error('knowledge access denied')
    )
    await expect(retry()).rejects.toThrow('knowledge access denied')
    expect(m.persist).not.toHaveBeenCalled()
  })
  it('refuses another Sim user bound to the original thread', async () => {
    m.limit
      .mockResolvedValueOnce([viewer])
      .mockResolvedValueOnce([turn])
      .mockResolvedValueOnce([{ ...thread, userId: 'other-user' }])
    await expect(retry()).rejects.toThrow('different account')
    expect(m.persist).not.toHaveBeenCalled()
  })
})

describe('Slack onboarding control delivery', () => {
  const slackPrincipal = {
    kind: 'slack_installation',
    credentialId: job.credentialId,
    credentialVersion: job.credentialVersion,
    appId: 'A1',
    teamId: 'T1',
    eventId: 'Ev1',
    receivedAt: new Date(),
  } as const
  const send = (
    reason: 'account' | 'sources' = 'account',
    message: SlackSearchMessage = job.message,
    signal = new AbortController().signal
  ) =>
    sendSlackSearchOnboarding(slackPrincipal, {
      job: { ...job, message },
      turnId: 'turn1',
      leaseId: 'lease1',
      email: state.email,
      reason,
      signal,
    })
  it('posts a thread-scoped signup link without bot secrets or email in its URL', async () => {
    const result = await send()
    expect(result.url).toBe('https://sim.test/slack-search/connect/opaque-token')
    expect(m.post).toHaveBeenCalledWith(
      'bot-secret',
      expect.objectContaining({
        channel: 'D1',
        thread_ts: job.message.threadTs,
        unfurl_links: false,
      }),
      expect.any(AbortSignal)
    )
    expect(JSON.stringify(m.post.mock.calls[0][1])).not.toContain('bot-secret')
    expect(m.store).toHaveBeenCalledWith(
      expect.objectContaining({ turnId: 'turn1', email: state.email })
    )
  })
  it.each(['account', 'sources'] as const)(
    'rechecks the binding and lease immediately before %s delivery',
    async (reason) => {
      m.authorize.mockResolvedValueOnce(context).mockResolvedValueOnce(null)
      await expect(send(reason)).rejects.toThrow('disabled')
      expect(m.post).not.toHaveBeenCalled()
      expect(m.api).toHaveBeenCalledTimes(1)
      expect(m.lease).toHaveBeenCalledWith('turn1', 'lease1')
    }
  )
  it('does not retry an ambiguous post or fall back to another transport', async () => {
    m.post.mockRejectedValueOnce(new Error('connection lost after send'))
    await expect(send()).rejects.toThrow('connection lost after send')
    expect(m.post).toHaveBeenCalledOnce()
    expect(m.outcome).not.toHaveBeenCalled()
  })
  it('rejects a non-Slack permalink before creating a handoff', async () => {
    m.api.mockResolvedValueOnce({
      status: 200,
      data: { ok: true, permalink: 'https://evil.example/redirect' },
    })
    await expect(send()).rejects.toThrow('invalid question link')
    expect(m.store).not.toHaveBeenCalled()
    expect(m.post).not.toHaveBeenCalled()
  })
})
