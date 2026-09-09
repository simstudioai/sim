/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  authorize: vi.fn(),
  sender: vi.fn(),
  member: vi.fn(),
  chat: vi.fn(),
  persist: vi.fn(),
  lock: vi.fn(),
  owners: vi.fn(),
  release: vi.fn(),
  run: vi.fn(),
  createRun: vi.fn(),
  updateRun: vi.fn(),
  finalize: vi.fn(),
  start: vi.fn(),
  finish: vi.fn(),
  finishWithError: vi.fn(),
  terminate: vi.fn(),
  streamOptions: vi.fn(),
  payload: vi.fn(),
  outcome: vi.fn(),
  memberAuthorization: vi.fn(),
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
  authorizeSlackSearchInstallation: m.authorize,
}))
vi.mock('@/lib/internal/slack/search-client', () => ({ getSlackSearchSender: m.sender }))
vi.mock('@/lib/knowledge/application/slack-search/identity', () => ({
  resolveSlackSearchMember: m.member,
  SlackSearchIdentityError: class extends Error {},
}))
vi.mock('@/lib/knowledge/application/slack-search/chat', () => ({
  resolveSlackSearchChat: m.chat,
  persistSlackSearchQuestion: m.persist,
  slackSearchChatOperation: { id: 'organization.chats.slack' },
}))
vi.mock('@/lib/core/application/organization-authorization', () => ({
  authorizeOrganizationOperation: m.memberAuthorization,
}))
vi.mock('@/lib/knowledge/application/operations', () => ({
  knowledgeOperations: { search: { organizationOperation: { id: 'knowledge.search' } } },
}))
vi.mock('@/lib/knowledge/application/slack-search/repository', () => ({
  recordSlackSearchOutcome: m.outcome,
}))
vi.mock('@/lib/knowledge/application/slack-search/turns', () => ({
  requireSlackSearchTurnLease: m.lease,
  wasSlackSearchTurnStopped: m.stopped,
}))
vi.mock('@/lib/knowledge/application/slack-search/source-status', () => ({
  getSlackSearchSourceStatus: { execute: m.sources },
}))
vi.mock('@/lib/knowledge/application/slack-search/onboarding', () => ({
  sendSlackSearchOnboarding: m.onboarding,
}))
vi.mock('@/lib/knowledge/application/slack-search/title', () => ({
  generateSlackSearchChatTitle: m.title,
}))
vi.mock('@/lib/billing/core/billing-attribution', () => ({
  resolveOrganizationBillingAttribution: async () => ({
    organizationId: 'org1',
    actorUserId: 'member1',
  }),
}))
vi.mock('@/lib/copilot/async-runs/repository', () => ({
  createRunSegment: m.createRun,
  updateRunStatus: m.updateRun,
}))
vi.mock('@/lib/copilot/chat/payload', () => ({ buildCopilotRequestPayload: m.payload }))
vi.mock('@/lib/copilot/chat/persisted-message', () => ({
  buildPersistedAssistantMessage: m.buildMessage,
  withStoppedContentBlock: m.stoppedMessage,
  normalizeMessage: (message: unknown) => message,
}))
vi.mock('@/lib/copilot/chat/terminal-state', () => ({ finalizeAssistantTurn: m.finalize }))
vi.mock('@/lib/copilot/environment-context', () => ({
  prepareCopilotEnvironmentContext: async () => ({ resolvedSecretTraceRegistry: {} }),
}))
vi.mock('@/lib/copilot/request/lifecycle/headless', () => ({ runHeadlessCopilotLifecycle: m.run }))
vi.mock('@/lib/copilot/request/session/abort', () => ({
  acquirePendingChatStream: m.lock,
  cleanupAbortMarker: vi.fn(),
  getChatStreamLockOwners: m.owners,
  registerActiveStream: vi.fn(),
  releasePendingChatStream: m.release,
  startAbortPoller: () => 0,
  unregisterActiveStream: vi.fn(),
}))
vi.mock('@/lib/slack-search/assistant-stream', () => ({
  SlackSearchAssistantStream: class {
    constructor(options: unknown) {
      m.streamOptions(options)
    }
    start = m.start
    finish = m.finish
    finishWithError = m.finishWithError
    terminateAfterFailure = m.terminate
    onEvent = vi.fn()
    assertHealthy = vi.fn()
  },
}))

vi.mock('@/executor/utils/resolved-secret-content-projection', () => ({
  projectResolvedSecretDiagnosticContent: (value: unknown) => ({ safe: true, value }),
}))

import { runSlackSearchAssistant } from '@/lib/knowledge/application/slack-search/assistant'
import { SlackSearchIdentityError } from '@/lib/knowledge/application/slack-search/identity'

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
  vi.clearAllMocks()
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
  it('persists source onboarding in private history without spending an Assistant run', async () => {
    m.sources.mockResolvedValueOnce({ hasSearchableDocuments: false })
    await run()
    expect(m.onboarding).toHaveBeenCalledWith(
      principal,
      expect.objectContaining({ reason: 'sources' })
    )
    expect(m.run).not.toHaveBeenCalled()
    expect(m.createRun).not.toHaveBeenCalled()
    expect(m.title).toHaveBeenCalledWith(
      expect.objectContaining({ subjectUserId: 'member1', organizationId: 'org1' }),
      expect.objectContaining({ job, signal: expect.any(AbortSignal) })
    )
    expect(m.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantMessage: expect.objectContaining({
          content: expect.stringContaining('[Connect sources]'),
        }),
      })
    )
  })
  it('delivers onboarding while naming runs and awaits naming before releasing the worker', async () => {
    const naming = Promise.withResolvers<void>()
    m.title.mockReturnValueOnce(naming.promise)
    m.sources.mockResolvedValueOnce({ hasSearchableDocuments: false })
    const pending = run()
    await vi.waitFor(() => expect(m.onboarding).toHaveBeenCalled())
    expect(m.release).not.toHaveBeenCalled()
    naming.resolve()
    await pending
    expect(m.release).toHaveBeenCalled()
  })
  it.each(['missing response', 'database error'] as const)(
    'fails source onboarding when history persistence reports %s',
    async (outcome) => {
      m.sources.mockResolvedValueOnce({ hasSearchableDocuments: false })
      if (outcome === 'missing response') {
        m.finalize.mockResolvedValueOnce({ appendedAssistant: false })
      } else {
        m.finalize.mockRejectedValueOnce(new Error('History unavailable'))
      }
      await expect(run()).rejects.toThrow(
        outcome === 'missing response'
          ? 'Could not persist the Slack Assistant response'
          : 'History unavailable'
      )
      expect(m.onboarding).toHaveBeenCalledOnce()
      expect(m.run).not.toHaveBeenCalled()
      expect(m.release).toHaveBeenCalledOnce()
    }
  )
  it('keeps title generation failure separate from a successful answer', async () => {
    m.title.mockRejectedValueOnce(new Error('Title generation failed'))
    await run()
    expect(m.finish).toHaveBeenCalled()
    expect(m.finalize).toHaveBeenCalled()
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
        billingAttribution: { organizationId: 'org1', actorUserId: 'member1' },
      })
    )
    expect(m.run.mock.calls[0][1]).not.toHaveProperty('workspaceId')
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
  it('rechecks cleanup authority with a fresh signal after aborting execution', async () => {
    m.run.mockRejectedValueOnce(new Error('Assistant disconnected'))
    m.terminate.mockImplementationOnce(async () => {
      const options = m.streamOptions.mock.calls[0][0]
      expect(options.controller.signal.aborted).toBe(true)
      await options.beforeCleanup(new AbortController().signal)
    })
    await expect(run()).rejects.toThrow('Assistant disconnected')
    expect(m.terminate).toHaveBeenCalledOnce()
    expect(m.memberAuthorization).toHaveBeenCalled()
    expect(m.terminate.mock.invocationCallOrder[0]).toBeLessThan(
      m.release.mock.invocationCallOrder[0]
    )
  })
  it('closes a healthy Slack stream when the Assistant reports failure', async () => {
    m.run.mockResolvedValueOnce({ success: false, content: '', contentBlocks: [], toolCalls: [] })
    await expect(run()).rejects.toThrow('Organization Assistant did not complete')
    expect(m.finishWithError).toHaveBeenCalledOnce()
    expect(m.finish).not.toHaveBeenCalled()
    expect(m.outcome).toHaveBeenCalledWith(expect.anything(), 'assistant_or_delivery_failed')
    expect(m.stoppedMessage).not.toHaveBeenCalled()
    expect(m.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantMessage: expect.objectContaining({
          content: 'I couldn’t complete this search. Please try again.',
        }),
      })
    )
  })
  it('marks private history as stopped only when the turn was cancelled by native Stop', async () => {
    m.run.mockRejectedValueOnce(new Error('Stream stopped'))
    m.stopped.mockResolvedValue(true)
    await expect(run()).rejects.toThrow('Stream stopped')
    expect(m.stoppedMessage).toHaveBeenCalledOnce()
    expect(m.finishWithError).not.toHaveBeenCalled()
    expect(m.terminate).not.toHaveBeenCalled()
  })
})
