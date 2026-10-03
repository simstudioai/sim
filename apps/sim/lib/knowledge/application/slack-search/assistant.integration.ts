/**
 * The Slack Assistant's run record against real PostgreSQL: the run row it admits and
 * the terminal status it records are production code. Slack delivery, the worker
 * lifecycle, identity, and chat locking are stood in, since only the record's outcome
 * is under test.
 */
import { billingAttributionMock } from '@sim/testing/mocks/billing-attribution.mock'
import {
  mothershipChatPayloadMock,
  mothershipChatPayloadMockFns,
} from '@sim/testing/mocks/mothership-chat-payload.mock'
import { mothershipEnvironmentContextMock } from '@sim/testing/mocks/mothership-environment-context.mock'
import { organizationAuthorizationMock } from '@sim/testing/mocks/organization-authorization.mock'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  chat: { id: '', model: 'default' },
  turnId: '',
  userId: '',
  organizationId: '',
  lifecycle: vi.fn(),
  /** The turn's own controller, which a Stop aborts through its registered stream. */
  controller: new AbortController(),
  stopped: vi.fn(async () => false),
  outcome: vi.fn(async () => undefined),
  finalize: vi.fn(async () => ({ appendedAssistant: true })),
}))
vi.mock('@/lib/knowledge/application/slack-search/authorization', () => ({
  authorizeSlackSearchInstallation: async () => ({
    installation: { id: 'i1', organizationId: hoisted.organizationId, teamId: 'T1' },
    secret: { botToken: 'token' },
  }),
}))
vi.mock('@/lib/internal/slack/search-client', () => ({
  getSlackSearchSender: async () => ({ email: 'member@example.com' }),
}))
vi.mock('@/lib/knowledge/application/slack-search/identity', () => ({
  resolveSlackSearchMember: async () => hoisted.userId,
  SlackSearchIdentityError: class extends Error {},
}))
vi.mock('@/lib/knowledge/application/slack-search/chat', () => ({
  resolveSlackSearchChat: async () => hoisted.chat,
  persistSlackSearchQuestion: async () => undefined,
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
  requireSlackSearchTurnLease: async () => undefined,
  wasSlackSearchTurnStopped: hoisted.stopped,
}))
vi.mock('@/lib/knowledge/application/slack-search/onboarding', () => ({
  sendSlackSearchOnboarding: vi.fn(),
}))
vi.mock('@/lib/knowledge/application/slack-search/title', () => ({
  generateSlackSearchChatTitle: async () => undefined,
}))
vi.mock('@/lib/billing/core/billing-attribution', () => billingAttributionMock)
vi.mock('@/lib/mothership/application/load-search-integrations', () => ({
  loadCopilotSearchIntegrations: async () => '{"connections":[],"available":[]}',
}))
vi.mock('@/lib/mothership/chat/payload', () => mothershipChatPayloadMock)
vi.mock('@/lib/mothership/chat/terminal-state', () => ({
  finalizeAssistantTurn: hoisted.finalize,
}))
vi.mock('@/lib/mothership/environment-context', () => mothershipEnvironmentContextMock)
vi.mock('@/lib/mothership/request/lifecycle/headless', () => ({
  runHeadlessCopilotLifecycle: hoisted.lifecycle,
}))
vi.mock('@/lib/mothership/request/session/abort', () => ({
  acquirePendingChatStream: async () => true,
  cleanupAbortMarker: async () => undefined,
  getChatStreamLockOwners: async () => ({
    status: 'verified',
    ownersByChatId: new Map([[hoisted.chat.id, hoisted.turnId]]),
  }),
  registerActiveStream: vi.fn(),
  releasePendingChatStream: async () => undefined,
  startAbortPoller: () => 0,
  unregisterActiveStream: vi.fn(),
}))
vi.mock('@/executor/utils/resolved-secret-content-projection', () => ({
  projectResolvedSecretDiagnosticContent: (value: unknown) => ({ safe: true, value }),
}))
vi.mock('@/lib/slack-search/connections', () => ({ deliverSlackSearchConnections: vi.fn() }))
vi.mock('@/lib/slack-search/assistant-stream', () => ({
  SlackSearchAssistantStream: class {
    start = async () => undefined
    finish = async () => undefined
    finishWithError = async () => undefined
    terminateAfterFailure = async () => undefined
    onEvent = async () => undefined
    assertHealthy = () => undefined
  },
}))

import { db } from '@sim/db'
import { copilotChats, copilotRuns, organization, user } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { runSlackSearchAssistant } from '@/lib/knowledge/application/slack-search/assistant'
import { AbortReason } from '@/lib/mothership/request/session/abort-reason'

const principal = {
  kind: 'slack_installation',
  credentialId: 'c1',
  credentialVersion: 'v1',
  appId: 'A1',
  teamId: 'T1',
  eventId: 'Ev1',
  receivedAt: new Date(),
} as const

function job() {
  return {
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
}

/** Runs one Slack turn in a fresh private chat and returns the run it recorded. */
async function slackTurn() {
  const chatId = generateId()
  const turnId = generateId()
  hoisted.chat = { id: chatId, model: 'default' }
  hoisted.turnId = turnId
  await db.insert(copilotChats).values({
    id: chatId,
    userId: hoisted.userId,
    organizationId: hoisted.organizationId,
    type: 'mothership',
  })
  const controller = new AbortController()
  hoisted.controller = controller
  const outcome = await runSlackSearchAssistant(principal, {
    job: job(),
    turnId,
    leaseId: generateId(),
    controller,
  }).then(
    () => undefined,
    (error: unknown) => error
  )
  const [run] = await db.select().from(copilotRuns).where(eq(copilotRuns.chatId, chatId))
  return { run, outcome }
}

describe('Slack Assistant run record', () => {
  beforeAll(async () => {
    hoisted.userId = generateId()
    hoisted.organizationId = generateId()
    const now = new Date()
    await db.insert(user).values({
      id: hoisted.userId,
      name: 'Slack Assistant fixture',
      email: `${hoisted.userId}@slack-assistant.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(organization).values({
      id: hoisted.organizationId,
      name: 'Slack Assistant fixture',
      slug: `slack-assistant-${hoisted.organizationId}`,
    })
    mothershipChatPayloadMockFns.mockBuildCopilotRequestPayload.mockResolvedValue({
      mode: 'assistant',
    })
  })

  afterAll(async () => {
    await db.delete(copilotChats).where(eq(copilotChats.userId, hoisted.userId))
    await db.delete(organization).where(eq(organization.id, hoisted.organizationId))
    await db.delete(user).where(eq(user.id, hoisted.userId))
  })

  beforeEach(() => {
    hoisted.stopped.mockResolvedValue(false)
    hoisted.outcome.mockResolvedValue(undefined)
    hoisted.finalize.mockResolvedValue({ appendedAssistant: true })
  })

  const answered = {
    success: true,
    content: 'Answer',
    contentBlocks: [],
    toolCalls: [],
  }

  it('records a completed turn as complete', async () => {
    hoisted.lifecycle.mockResolvedValueOnce({
      success: true,
      content: 'Answer',
      contentBlocks: [],
      toolCalls: [],
    })

    const { run, outcome } = await slackTurn()

    expect(outcome).toBeUndefined()
    expect(run.status).toBe('complete')
    expect(run.completedAt).not.toBeNull()
  })

  it('records a turn its user stopped as cancelled', async () => {
    hoisted.lifecycle.mockImplementationOnce(async () => {
      /** A Slack Stop marks the turn stopped, then aborts its registered stream. */
      hoisted.stopped.mockResolvedValue(true)
      hoisted.controller.abort(AbortReason.UserStop)
      return { success: false, cancelled: true, content: '', contentBlocks: [], toolCalls: [] }
    })

    const { run } = await slackTurn()

    expect(run.status).toBe('cancelled')
    expect(run.completedAt).not.toBeNull()
  })

  it('records a failed turn as an error', async () => {
    hoisted.lifecycle.mockResolvedValueOnce({
      success: false,
      error: 'worker failed',
      content: '',
      contentBlocks: [],
      toolCalls: [],
    })

    const { run, outcome } = await slackTurn()

    expect(outcome).toBeInstanceOf(Error)
    expect(run.status).toBe('error')
  })

  it('records a failed turn as an error even when its Stop cannot be looked up', async () => {
    hoisted.stopped.mockRejectedValue(new Error('database unavailable'))
    hoisted.lifecycle.mockResolvedValueOnce({
      success: false,
      error: 'worker failed',
      content: '',
      contentBlocks: [],
      toolCalls: [],
    })

    const { run, outcome } = await slackTurn()

    expect(outcome).toBeInstanceOf(Error)
    expect(run.status).toBe('error')
  })

  it('records an answered turn as an error when its response is not saved', async () => {
    hoisted.lifecycle.mockResolvedValueOnce(answered)
    hoisted.finalize.mockResolvedValue({ appendedAssistant: false })

    const { run, outcome } = await slackTurn()

    expect(outcome).toBeInstanceOf(Error)
    expect(run.status).toBe('error')
  })

  it('records an answered turn as an error when its outcome is not saved', async () => {
    hoisted.lifecycle.mockResolvedValueOnce(answered)
    hoisted.outcome.mockRejectedValueOnce(new Error('outcome write failed'))

    const { run, outcome } = await slackTurn()

    expect(outcome).toBeInstanceOf(Error)
    expect(run.status).toBe('error')
  })
})
