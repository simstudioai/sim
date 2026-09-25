import {
  billingAttributionMock,
  billingAttributionMockFns,
} from '@sim/testing/mocks/billing-attribution.mock'
import {
  mothershipAsyncRunsMock,
  mothershipAsyncRunsMockFns,
} from '@sim/testing/mocks/mothership-async-runs.mock'
import {
  mothershipChatPayloadMock,
  mothershipChatPayloadMockFns,
} from '@sim/testing/mocks/mothership-chat-payload.mock'
import { mothershipEnvironmentContextMock } from '@sim/testing/mocks/mothership-environment-context.mock'
import { organizationAuthorizationMock } from '@sim/testing/mocks/organization-authorization.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  authorize: vi.fn(),
  sender: vi.fn(),
  member: vi.fn(),
  chat: vi.fn(),
  persist: vi.fn(),
  lock: vi.fn(),
  owners: vi.fn(),
  release: vi.fn(),
  run: vi.fn(),
  finalize: vi.fn(),
  start: vi.fn(),
  finish: vi.fn(),
  finishWithError: vi.fn(),
  terminate: vi.fn(),
  streamOptions: vi.fn(),
  inventory: vi.fn(),
  outcome: vi.fn(),
  lease: vi.fn(),
  stopped: vi.fn(),
  sources: vi.fn(),
  onboarding: vi.fn(),
  title: vi.fn(),
  stoppedMessage: vi.fn((message: unknown) => message),
  buildMessage: vi.fn((result: { content: string }) => ({
    id: 'answer1',
    role: 'assistant',
    content: result.content,
  })),
}))
vi.mock('@/lib/knowledge/application/slack-search/authorization', () => ({
  authorizeSlackSearchInstallation: hoisted.authorize,
}))
vi.mock('@/lib/internal/slack/search-client', () => ({ getSlackSearchSender: hoisted.sender }))
vi.mock('@/lib/knowledge/application/slack-search/identity', () => ({
  resolveSlackSearchMember: hoisted.member,
  SlackSearchIdentityError: class extends Error {},
}))
vi.mock('@/lib/knowledge/application/slack-search/chat', () => ({
  resolveSlackSearchChat: hoisted.chat,
  persistSlackSearchQuestion: hoisted.persist,
  slackSearchChatOperation: { id: 'organization.chats.slack' },
}))
vi.mock('@/lib/core/application/organization-authorization', () => organizationAuthorizationMock)
vi.mock('@/lib/knowledge/application/operations', () => ({
  knowledgeOperations: { search: { organizationOperation: { id: 'knowledge.search' } } },
}))
vi.mock('@/lib/knowledge/application/slack-search/repository', () => ({
  recordSlackSearchOutcome: hoisted.outcome,
}))
vi.mock('@/lib/knowledge/application/slack-search/turns', () => ({
  requireSlackSearchTurnLease: hoisted.lease,
  wasSlackSearchTurnStopped: hoisted.stopped,
}))
vi.mock('@/lib/knowledge/application/slack-search/source-status', () => ({
  getSlackSearchSourceStatus: { execute: hoisted.sources },
}))
vi.mock('@/lib/knowledge/application/slack-search/onboarding', () => ({
  sendSlackSearchOnboarding: hoisted.onboarding,
}))
vi.mock('@/lib/knowledge/application/slack-search/title', () => ({
  generateSlackSearchChatTitle: hoisted.title,
}))
vi.mock('@/lib/billing/core/billing-attribution', () => billingAttributionMock)
vi.mock('@/lib/mothership/async-runs/repository', () => mothershipAsyncRunsMock)
vi.mock('@/lib/mothership/application/load-search-integrations', () => ({
  loadCopilotSearchIntegrations: hoisted.inventory,
}))
vi.mock('@/lib/mothership/chat/payload', () => mothershipChatPayloadMock)
vi.mock('@/lib/mothership/chat/persisted-message', () => ({
  buildPersistedAssistantMessage: hoisted.buildMessage,
  withStoppedContentBlock: hoisted.stoppedMessage,
  normalizeMessage: (message: unknown) => message,
}))
vi.mock('@/lib/mothership/chat/terminal-state', () => ({ finalizeAssistantTurn: hoisted.finalize }))
vi.mock('@/lib/mothership/environment-context', () => mothershipEnvironmentContextMock)
vi.mock('@/lib/mothership/request/lifecycle/headless', () => ({
  runHeadlessCopilotLifecycle: hoisted.run,
}))
vi.mock('@/lib/mothership/request/session/abort', () => ({
  acquirePendingChatStream: hoisted.lock,
  cleanupAbortMarker: vi.fn(),
  getChatStreamLockOwners: hoisted.owners,
  registerActiveStream: vi.fn(),
  releasePendingChatStream: hoisted.release,
  startAbortPoller: () => 0,
  unregisterActiveStream: vi.fn(),
}))
vi.mock('@/lib/slack-search/connections', () => ({ deliverSlackSearchConnections: vi.fn() }))
vi.mock('@/lib/slack-search/assistant-stream', () => ({
  SlackSearchAssistantStream: class {
    constructor(options: unknown) {
      hoisted.streamOptions(options)
    }
    start = hoisted.start
    finish = hoisted.finish
    finishWithError = hoisted.finishWithError
    terminateAfterFailure = hoisted.terminate
    onEvent = vi.fn()
    assertHealthy = vi.fn()
  },
}))

vi.mock('@/executor/utils/resolved-secret-content-projection', () => ({
  projectResolvedSecretDiagnosticContent: (value: unknown) => ({ safe: true, value }),
}))

import { runSlackSearchAssistant } from '@/lib/knowledge/application/slack-search/assistant'
import { SlackSearchIdentityError } from '@/lib/knowledge/application/slack-search/identity'

const m = {
  ...hoisted,
  createRun: mothershipAsyncRunsMockFns.mockCreateRunSegment,
  updateRun: mothershipAsyncRunsMockFns.mockUpdateRunStatus,
  payload: mothershipChatPayloadMockFns.mockBuildCopilotRequestPayload,
}

billingAttributionMockFns.mockResolveOrganizationBillingAttribution.mockImplementation(
  async () => ({
    organizationId: 'org1',
    actorUserId: 'member1',
  })
)

const principal = {
  kind: 'slack_installation',
  credentialId: 'c1',
  credentialVersion: 'v1',
  appId: 'A1',
  teamId: 'T1',
  eventId: 'Ev1',
  receivedAt: new Date(),
} as const
const job = {
  installationId: 'i1',
  revision: 'r1',
  credentialId: 'c1',
  credentialVersion: 'v1',
  receivedAt: Date.now(),
  message: {
    appId: 'A1',
    teamId: 'T1',
    eventId: 'Ev1',
    channelId: 'D1',
    userId: 'U1',
    messageTs: '1800000000.000001',
    query: 'release notes',
    queryTooLong: false,
  },
}
const run = () =>
  runSlackSearchAssistant(principal, {
    job,
    turnId: 'turn1',
    leaseId: 'lease1',
    controller: new AbortController(),
  })
beforeEach(() => {
  m.authorize.mockResolvedValue({
    installation: { id: 'i1', organizationId: 'org1', teamId: 'T1' },
    secret: { botToken: 'token' },
  })
  m.sender.mockResolvedValue({ email: 'member@example.com' })
  m.member.mockResolvedValue('member1')
  m.chat.mockResolvedValue({ id: 'chat1', model: 'default' })
  m.title.mockResolvedValue(undefined)
  m.lock.mockResolvedValue(true)
  m.owners.mockResolvedValue({ status: 'verified', ownersByChatId: new Map([['chat1', 'turn1']]) })
  m.createRun.mockResolvedValue({ id: 'run1' })
  m.payload.mockResolvedValue({ mode: 'assistant' })
  m.inventory.mockResolvedValue('{"connections":[],"available":[]}')
  m.run.mockResolvedValue({ success: true, content: 'Answer', contentBlocks: [], toolCalls: [] })
  m.finalize.mockResolvedValue({ appendedAssistant: true })
  m.stopped.mockResolvedValue(false)
  m.sources.mockResolvedValue({ hasSearchableDocuments: true })
  m.onboarding.mockResolvedValue({
    text: 'Connect sources',
    url: 'https://sim.test/slack-search/connect/token',
  })
})
describe('organization Assistant from Slack', () => {
  it('offers account onboarding for a known Slack sender without a verified Sim membership', async () => {
    m.member.mockRejectedValueOnce(new SlackSearchIdentityError())
    await run()
    expect(m.onboarding).toHaveBeenCalledWith(
      principal,
      expect.objectContaining({ reason: 'account', email: 'member@example.com' })
    )
    expect(m.chat).not.toHaveBeenCalled()
    expect(m.title).not.toHaveBeenCalled()
    expect(m.run).not.toHaveBeenCalled()
  })
  it('propagates identity infrastructure failures instead of inviting the user to create another account', async () => {
    m.member.mockRejectedValueOnce(new Error('database failed'))
    await expect(run()).rejects.toThrow('database failed')
    expect(m.onboarding).not.toHaveBeenCalled()
  })
  it('uses the existing Assistant lifecycle as the verified sender with organization billing and private history', async () => {
    await run()
    expect(m.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectUserId: 'member1',
        organizationId: 'org1',
        serviceId: 'slack-search',
      }),
      job
    )
    expect(m.run).toHaveBeenCalledWith(
      { mode: 'assistant' },
      expect.objectContaining({
        userId: 'member1',
        organizationId: 'org1',
        chatId: 'chat1',
        goRoute: '/api/mothership',
        autoExecuteTools: true,
        searchSurface: 'slack',
        billingAttribution: { organizationId: 'org1', actorUserId: 'member1' },
      })
    )
    expect(m.run.mock.calls[0][1]).not.toHaveProperty('workspaceId')
    expect(new URL(m.streamOptions.mock.calls[0][0].integrationsUrl).pathname).toBe(
      '/o/org1/integrations'
    )
    expect(m.persist).toHaveBeenCalledWith('chat1', 'member1', 'turn1', 'release notes')
    expect(m.finalize).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 'chat1', userId: 'member1', userMessageId: 'turn1' })
    )
    expect(m.release).toHaveBeenCalledWith('chat1', 'turn1')
  })
  it('does not substitute an owner when Slack identity is unavailable', async () => {
    m.sender.mockResolvedValueOnce(null)
    await expect(run()).rejects.toThrow()
    expect(m.run).not.toHaveBeenCalled()
    expect(m.chat).not.toHaveBeenCalled()
  })
  it('does not run disabled installations', async () => {
    m.authorize.mockResolvedValueOnce(null)
    await expect(run()).rejects.toThrow('disabled')
    expect(m.run).not.toHaveBeenCalled()
  })
  it('does not steal the chat lock from a Sim browser conversation', async () => {
    m.lock.mockResolvedValueOnce(false)
    await expect(run()).rejects.toThrow('already answering')
    expect(m.persist).not.toHaveBeenCalled()
    expect(m.start).not.toHaveBeenCalled()
  })
  it('requires durable run persistence before sending or executing', async () => {
    m.createRun.mockResolvedValueOnce(undefined)
    await expect(run()).rejects.toThrow('persist Assistant execution')
    expect(m.run).not.toHaveBeenCalled()
    expect(m.start).not.toHaveBeenCalled()
    expect(m.release).toHaveBeenCalledOnce()
  })
  it('stops delivery after membership changes during the Assistant run', async () => {
    m.run.mockImplementationOnce(async () => {
      m.member.mockResolvedValue('other-user')
      return { success: true, content: 'Secret answer', contentBlocks: [], toolCalls: [] }
    })
    await expect(run()).rejects.toThrow()
    expect(m.finish).not.toHaveBeenCalled()
  })
  it('records a delivery failure and does not replay the Assistant', async () => {
    m.finish.mockRejectedValueOnce(new Error('ambiguous send'))
    await expect(run()).rejects.toThrow('ambiguous send')
    expect(m.run).toHaveBeenCalledOnce()
    expect(m.terminate).toHaveBeenCalledOnce()
    expect(m.updateRun).toHaveBeenCalledWith('run1', 'error')
    expect(m.release).toHaveBeenCalledOnce()
  })
})
