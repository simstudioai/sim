/**
 * Search MCP chat follow-ups against real PostgreSQL and Redis: which conversation a chatId
 * resumes, the per-conversation stream lock, and the transcript a turn leaves behind are
 * production code. Authorization, billing, the payload builder and the worker lifecycle are
 * stood in, since only conversation ownership, locking and persistence are under test.
 */
import { createDeferred } from '@sim/testing/helpers/deferred'
import { billingAttributionMock } from '@sim/testing/mocks/billing-attribution.mock'
import { knowledgeAvailabilityMock } from '@sim/testing/mocks/knowledge-availability.mock'
import {
  mothershipChatPayloadMock,
  mothershipChatPayloadMockFns,
} from '@sim/testing/mocks/mothership-chat-payload.mock'
import {
  mothershipHeadlessLifecycleMock,
  mothershipHeadlessLifecycleMockFns,
} from '@sim/testing/mocks/mothership-headless-lifecycle.mock'
import {
  organizationAuthorizationMock,
  organizationAuthorizationMockFns,
} from '@sim/testing/mocks/organization-authorization.mock'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/application/organization-authorization', () => organizationAuthorizationMock)
vi.mock('@/lib/knowledge/access/availability', () => knowledgeAvailabilityMock)
vi.mock('@/lib/billing/core/attribution', () => billingAttributionMock)
vi.mock('@/lib/mothership/application/load-search-integrations', () => ({
  loadCopilotSearchIntegrations: async () => '{"connections":[],"available":[]}',
}))
vi.mock('@/lib/mothership/chat/payload', () => mothershipChatPayloadMock)
vi.mock('@/lib/mothership/request/lifecycle/headless', () => mothershipHeadlessLifecycleMock)
vi.mock('@/lib/mothership/request/session/explicit-abort', () => ({
  requestExplicitStreamAbort: async () => undefined,
}))

import type { OAuthAccessTokenPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { copilotChats, copilotMessages, organization, user } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { organizationSearchChat } from '@/lib/knowledge/application/chat'
import type { OrchestratorResult } from '@/lib/mothership/request/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const { mockRunHeadlessCopilotLifecycle } = mothershipHeadlessLifecycleMockFns
const memberId = generateId()
const otherMemberId = generateId()
const organizationId = generateId()
const otherOrganizationId = generateId()

function principalFor(userId: string): OAuthAccessTokenPrincipal {
  return {
    kind: 'oauth_access_token',
    userId,
    clientId: 'mcp-client',
    tokenId: generateId(),
    scopes: ['search:read'],
    expiresAt: new Date(Date.now() + 3_600_000),
  }
}

function answer(content: string): OrchestratorResult {
  return { success: true, content, contentBlocks: [], toolCalls: [] }
}

function ask(query: string, chatId?: string, userId = memberId) {
  return organizationSearchChat.execute({
    principal: principalFor(userId),
    input: {
      organizationId,
      query,
      ...(chatId ? { chatId } : {}),
      resultSecretRegistry: new ResolvedSecretTraceRegistry(),
    },
  })
}

async function transcript(chatId: string) {
  return db
    .select({ id: copilotMessages.id })
    .from(copilotMessages)
    .where(eq(copilotMessages.chatId, chatId))
}

async function liveChats(userId: string) {
  return db
    .select({ id: copilotChats.id })
    .from(copilotChats)
    .where(and(eq(copilotChats.userId, userId), isNull(copilotChats.deletedAt)))
}

describe('Search MCP chat follow-ups', () => {
  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values(
      [memberId, otherMemberId].map((id) => ({
        id,
        name: 'Search chat fixture',
        email: `${id}@search-chat.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      }))
    )
    await db.insert(organization).values(
      [organizationId, otherOrganizationId].map((id) => ({
        id,
        name: 'Search chat fixture',
        slug: `search-chat-${id}`,
      }))
    )
    mothershipChatPayloadMockFns.mockBuildCopilotRequestPayload.mockResolvedValue({
      mode: 'assistant',
    })
  })

  afterAll(async () => {
    await db.delete(copilotChats).where(inArray(copilotChats.userId, [memberId, otherMemberId]))
    await db
      .delete(organization)
      .where(inArray(organization.id, [organizationId, otherOrganizationId]))
    await db.delete(user).where(inArray(user.id, [memberId, otherMemberId]))
  })

  beforeEach(() => {
    mockRunHeadlessCopilotLifecycle.mockReset()
    organizationAuthorizationMockFns.mockAuthorizeOrganizationOperation.mockImplementation(
      async (principal: OAuthAccessTokenPrincipal) => ({
        userId: principal.userId,
        organizationId,
      })
    )
  })

  it('continues the caller’s conversation with the same chat and transcript', async () => {
    mockRunHeadlessCopilotLifecycle.mockResolvedValueOnce(answer('The kit is in the suitcase.'))
    const first = await ask('Where is the field kit?')
    if (!first.chatId) throw new Error('Expected a saved conversation')

    mockRunHeadlessCopilotLifecycle.mockResolvedValueOnce(answer('It is violet.'))
    const followUp = await ask('What colour is it?', first.chatId)

    expect(followUp.chatId).toBe(first.chatId)
    expect(mockRunHeadlessCopilotLifecycle).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ chatId: first.chatId })
    )
    expect(await transcript(first.chatId)).toHaveLength(4)
    expect(await liveChats(memberId)).toEqual([{ id: first.chatId }])
  })

  it.each([
    ['another member’s conversation', 'other-member'],
    ['a conversation in another organization', 'other-organization'],
    ['a deleted conversation', 'deleted'],
    ['an Agent conversation', 'agent'],
    ['a value that is not a chat ID', 'malformed'],
  ])('refuses %s as not found before running anything', async (_case, kind) => {
    const chatId = generateId()
    if (kind !== 'malformed')
      await db.insert(copilotChats).values({
        id: chatId,
        userId: kind === 'other-member' ? otherMemberId : memberId,
        organizationId: kind === 'other-organization' ? otherOrganizationId : organizationId,
        type: 'mothership',
        ...(kind === 'deleted' ? { deletedAt: new Date() } : {}),
        ...(kind === 'agent' ? { config: { conversationMode: 'agent' } } : {}),
      })
    await expect(
      ask('Follow up', kind === 'malformed' ? 'not-a-chat' : chatId)
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mockRunHeadlessCopilotLifecycle).not.toHaveBeenCalled()
  })

  it('refuses a follow-up while the conversation is still answering', async () => {
    mockRunHeadlessCopilotLifecycle.mockResolvedValueOnce(answer('First answer.'))
    const { chatId } = await ask('First question')
    if (!chatId) throw new Error('Expected a saved conversation')

    const running = createDeferred<OrchestratorResult>()
    const started = createDeferred<void>()
    mockRunHeadlessCopilotLifecycle.mockImplementationOnce(async () => {
      started.resolve()
      return running.promise
    })
    const inFlight = ask('Second question', chatId)
    await started.promise

    await expect(ask('Third question', chatId)).rejects.toMatchObject({ code: 'conflict' })
    running.resolve(answer('Second answer.'))
    await expect(inFlight).resolves.toMatchObject({ chatId })

    mockRunHeadlessCopilotLifecycle.mockResolvedValueOnce(answer('Third answer.'))
    await expect(ask('Third question', chatId)).resolves.toMatchObject({ chatId })
    expect(await transcript(chatId)).toHaveLength(6)
  })

  it('keeps a resumed conversation when its follow-up fails', async () => {
    mockRunHeadlessCopilotLifecycle.mockResolvedValueOnce(answer('First answer.'))
    const { chatId } = await ask('First question')
    if (!chatId) throw new Error('Expected a saved conversation')

    mockRunHeadlessCopilotLifecycle.mockResolvedValueOnce({ ...answer(''), success: false })
    await expect(ask('Second question', chatId)).rejects.toThrow('could not finish')

    expect(await liveChats(memberId)).toContainEqual({ id: chatId })
    expect(await transcript(chatId)).toHaveLength(2)
  })
})
