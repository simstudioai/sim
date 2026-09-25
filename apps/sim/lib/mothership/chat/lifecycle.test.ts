import { dbChainMockFns, resetDbChainMock, schemaMock, workflowAuthzMockFns } from '@sim/testing'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import {
  mothershipOrganizationChatsMock,
  mothershipOrganizationChatsMockFns,
} from '@sim/testing/mocks/mothership-organization-chats.mock'
import { permissionsMock } from '@sim/testing/mocks/permissions.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { createTrustedOrganizationCopilotPrincipal } from '@/lib/mothership/auth/application-delegation'

const {
  mockAuthorizeWorkflowByWorkspacePermission: mockAuthorizeWorkflow,
  mockGetActiveWorkflowRecord: mockGetActiveWorkflow,
} = workflowAuthzMockFns

afterAll(() => {
  mockAuthorizeWorkflow.mockReset()
  mockGetActiveWorkflow.mockReset()
})

const {
  mockAuthorizeOrganizationChat: mockAuthorizeOrganization,
  mockAuthorizeOrganizationChatCancellation: mockAuthorizeCancellation,
} = mothershipOrganizationChatsMockFns
vi.mock('@/lib/mothership/chat/organization-chats', () => mothershipOrganizationChatsMock)

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

import {
  getAccessibleCopilotChat,
  getAccessibleCopilotChatAuth,
  getAccessibleCopilotChatForCancellation,
  getAccessibleCopilotChatWithMessages,
  resolveOrCreateChat,
} from '@/lib/mothership/chat/lifecycle'

const CHAT_ID = 'chat-1'
const USER_ID = 'user-1'

// A chat with no workflow/workspace skips the authz lookups and authorizes directly.
const chatRow = {
  id: CHAT_ID,
  userId: USER_ID,
  workflowId: null,
  workspaceId: null,
  organizationId: null,
  type: 'copilot',
  title: 'Test',
  conversationId: null,
  resources: [],
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

const userMsg = { id: 'm-user', role: 'user', content: 'Hi', timestamp: '2026-01-01T00:00:00.000Z' }
const asstMsg = {
  id: 'm-asst',
  role: 'assistant',
  content: 'Hello',
  timestamp: '2026-01-01T00:00:01.000Z',
}

describe('lifecycle copilot chat reads (cutover to copilot_messages)', () => {
  beforeEach(() => {
    resetDbChainMock()
    mockAuthorizeOrganization.mockResolvedValue({
      organizationId: 'org-1',
      userId: USER_ID,
      role: 'member',
    })
  })

  it('getAccessibleCopilotChatWithMessages sources messages from copilot_messages in seq order', async () => {
    // 1st query: chat metadata (select().from().where().limit())
    dbChainMockFns.limit.mockResolvedValueOnce([chatRow])
    // 2nd query: messages (select().from().where().orderBy())
    dbChainMockFns.orderBy.mockResolvedValueOnce([{ content: userMsg }, { content: asstMsg }])

    const result = await getAccessibleCopilotChatWithMessages(CHAT_ID, USER_ID)

    expect(result).not.toBeNull()
    expect(result?.messages).toEqual([userMsg, asstMsg])
    expect(dbChainMockFns.orderBy).toHaveBeenCalledTimes(1)
  })

  it('strips tool-result output on read, keeping success/error', async () => {
    const toolMsg = {
      id: 'm-tool',
      role: 'assistant',
      content: '',
      timestamp: '2026-01-01T00:00:02.000Z',
      contentBlocks: [
        {
          type: 'tool',
          phase: 'call',
          toolCall: {
            id: 'tc-1',
            name: 'get_workflow_logs',
            state: 'success',
            result: { success: true, output: { huge: 'x'.repeat(5000) } },
          },
        },
      ],
    }
    dbChainMockFns.limit.mockResolvedValueOnce([chatRow])
    dbChainMockFns.orderBy.mockResolvedValueOnce([{ content: toolMsg }])

    const result = await getAccessibleCopilotChatWithMessages(CHAT_ID, USER_ID)

    expect(result?.messages?.[0].contentBlocks?.[0].toolCall?.result).toEqual({ success: true })
    expect(JSON.stringify(result?.messages)).not.toContain('huge')
  })

  it('returns null and does NOT query messages when the chat is not found', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])

    const result = await getAccessibleCopilotChatWithMessages(CHAT_ID, USER_ID)

    expect(result).toBeNull()
    expect(dbChainMockFns.orderBy).not.toHaveBeenCalled()
  })

  it('returns null and does NOT query messages when the row is found but authorization fails', async () => {
    // Row exists but belongs to a workflow the user cannot read.
    dbChainMockFns.limit.mockResolvedValueOnce([{ ...chatRow, workflowId: 'wf-1' }])
    mockAuthorizeWorkflow.mockResolvedValueOnce({ allowed: false, workflow: null })

    const result = await getAccessibleCopilotChatWithMessages(CHAT_ID, USER_ID)

    expect(result).toBeNull()
    expect(dbChainMockFns.orderBy).not.toHaveBeenCalled()
  })

  it('legacy getAccessibleCopilotChat also assembles messages from copilot_messages', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ ...chatRow, model: 'm', config: null }])
    dbChainMockFns.orderBy.mockResolvedValueOnce([{ content: userMsg }])

    const result = await getAccessibleCopilotChat(CHAT_ID, USER_ID)

    expect(result?.messages).toEqual([userMsg])
  })

  it('scopes the chat lookup to the requesting user, not the chat id alone', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([chatRow])
    dbChainMockFns.orderBy.mockResolvedValueOnce([])

    await getAccessibleCopilotChatWithMessages(CHAT_ID, USER_ID)

    const predicate = dbChainMockFns.where.mock.calls[0]?.[0] as {
      type: string
      conditions: unknown[]
    }
    expect(predicate.type).toBe('and')
    // Three conditions exactly: dropping one silently widens the lookup, so the
    // count is asserted alongside the membership checks.
    expect(predicate.conditions).toHaveLength(3)
    expect(predicate.conditions).toContainEqual({
      type: 'eq',
      left: schemaMock.copilotChats.userId,
      right: USER_ID,
    })
    expect(predicate.conditions).toContainEqual({
      type: 'eq',
      left: schemaMock.copilotChats.id,
      right: CHAT_ID,
    })
    expect(predicate.conditions).toContainEqual({
      type: 'isNull',
      column: schemaMock.copilotChats.deletedAt,
    })
  })

  it('resolveOrCreateChat scopes its existing-chat lookup to the requesting user', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([chatRow])
    dbChainMockFns.orderBy.mockResolvedValueOnce([])

    await resolveOrCreateChat({ chatId: CHAT_ID, userId: USER_ID, model: 'm' })

    const predicate = dbChainMockFns.where.mock.calls[0]?.[0] as {
      type: string
      conditions: unknown[]
    }
    expect(predicate.conditions).toHaveLength(3)
    expect(predicate.conditions).toContainEqual({
      type: 'eq',
      left: schemaMock.copilotChats.userId,
      right: USER_ID,
    })
  })

  it('resolveOrCreateChat returns conversationHistory from the table for an existing chat', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([chatRow])
    dbChainMockFns.orderBy.mockResolvedValueOnce([{ content: userMsg }, { content: asstMsg }])

    const result = await resolveOrCreateChat({ chatId: CHAT_ID, userId: USER_ID, model: 'm' })

    expect(result.isNew).toBe(false)
    expect(result.conversationHistory).toEqual([userMsg, asstMsg])
  })

  it('resolveOrCreateChat refuses a resumed chat whose type is not the asserted one', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ ...chatRow, type: 'mothership' }])
    dbChainMockFns.orderBy.mockResolvedValueOnce([])

    const result = await resolveOrCreateChat({
      chatId: CHAT_ID,
      userId: USER_ID,
      model: 'm',
      type: 'copilot',
    })

    // Same shape an unknown id resolves to: the refusal carries no reason.
    expect(result.chat).toBeNull()
    expect(result.conversationHistory).toEqual([])
    expect(result.isNew).toBe(false)
  })

  it('resolveOrCreateChat resumes a chat whose type matches the asserted one', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ ...chatRow, type: 'mothership' }])
    dbChainMockFns.orderBy.mockResolvedValueOnce([{ content: userMsg }])

    const result = await resolveOrCreateChat({
      chatId: CHAT_ID,
      userId: USER_ID,
      model: 'm',
      type: 'mothership',
    })

    expect(result.chat).not.toBeNull()
    expect(result.conversationHistory).toEqual([userMsg])
  })
})

const orgPrincipal = createSessionPrincipal({ userId: USER_ID })

describe('organization chat isolation', () => {
  beforeEach(() => {
    dbChainMockFns.limit.mockReset()
    resetDbChainMock()
    mockAuthorizeOrganization.mockResolvedValue({
      organizationId: 'org-1',
      userId: USER_ID,
      role: 'member',
    })
  })

  it('allows an org member without a workspace to read their transcript', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { ...chatRow, organizationId: 'org-1', type: 'mothership' },
    ])
    dbChainMockFns.orderBy.mockResolvedValueOnce([{ content: userMsg }])
    const chat = await getAccessibleCopilotChatWithMessages(CHAT_ID, USER_ID, {
      principal: orgPrincipal,
    })
    expect(chat?.messages).toEqual([userMsg])
    expect(mockAuthorizeOrganization).toHaveBeenCalledWith({
      principal: orgPrincipal,
      input: { organizationId: 'org-1' },
    })
  })

  it('does not expose org content to a legacy caller without a principal', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ ...chatRow, organizationId: 'org-1' }])
    expect(await getAccessibleCopilotChatWithMessages(CHAT_ID, USER_ID)).toBeNull()
    expect(dbChainMockFns.orderBy).not.toHaveBeenCalled()
  })

  it('rejects a principal that does not represent the chat owner', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ ...chatRow, organizationId: 'org-1' }])
    expect(
      await getAccessibleCopilotChatWithMessages(CHAT_ID, USER_ID, {
        principal: { ...orgPrincipal, userId: 'other-user' },
      })
    ).toBeNull()
    expect(mockAuthorizeOrganization).not.toHaveBeenCalled()
    expect(dbChainMockFns.orderBy).not.toHaveBeenCalled()
  })

  it.each(['agent', 'assistant'] as const)(
    'retains the same transcript and resources when requesting %s for the next turn',
    async (mode) => {
      const resources = [{ type: 'table', id: 'table', title: 'Evidence' }]
      dbChainMockFns.limit.mockResolvedValueOnce([
        {
          ...chatRow,
          organizationId: 'org-1',
          type: 'mothership',
          mode: mode === 'agent' ? 'assistant' : 'agent',
          resources,
        },
      ])
      dbChainMockFns.orderBy.mockResolvedValueOnce([{ content: userMsg }, { content: asstMsg }])
      const result = await resolveOrCreateChat({
        chatId: CHAT_ID,
        userId: USER_ID,
        organizationId: 'org-1',
        principal: orgPrincipal,
        mode,
        model: 'm',
        type: 'mothership',
      })
      expect(result.chatId).toBe(CHAT_ID)
      expect(result.isNew).toBe(false)
      expect(result.chat?.resources).toEqual(resources)
      expect(result.conversationHistory).toEqual([userMsg, asstMsg])
      expect(mockAuthorizeOrganization).toHaveBeenCalledWith({
        principal: orgPrincipal,
        input: { organizationId: 'org-1', mode },
      })
      expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    }
  )

  it('refuses to resume an org chat through a different organization', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { ...chatRow, organizationId: 'org-2', type: 'mothership' },
    ])
    dbChainMockFns.orderBy.mockResolvedValueOnce([])
    const result = await resolveOrCreateChat({
      chatId: CHAT_ID,
      userId: USER_ID,
      organizationId: 'org-1',
      principal: orgPrincipal,
      model: 'm',
      type: 'mothership',
    })
    expect(result.chat).toBeNull()
    expect(result.conversationHistory).toEqual([])
  })

  it('rejects mixed organization and workspace ownership before creating a chat', async () => {
    await expect(
      resolveOrCreateChat({
        userId: USER_ID,
        organizationId: 'org-1',
        workspaceId: 'ws-1',
        principal: orgPrincipal,
        model: 'm',
      })
    ).rejects.toThrow('cannot have workspace')
    expect(dbChainMockFns.values).not.toHaveBeenCalled()
  })
})

describe('owned chat cancellation policy', () => {
  const orgChat = { ...chatRow, organizationId: 'org-1', type: 'mothership' }
  beforeEach(() => {
    resetDbChainMock()
    mockAuthorizeOrganization.mockReset().mockResolvedValue(undefined)
    mockAuthorizeCancellation.mockReset().mockResolvedValue(undefined)
  })

  it('allows stopping an owned org chat after capability revocation while ordinary reads remain denied', async () => {
    mockAuthorizeOrganization.mockRejectedValue(
      new OrchestrationError('forbidden', 'Copilot disabled')
    )
    dbChainMockFns.limit.mockResolvedValueOnce([orgChat]).mockResolvedValueOnce([orgChat])
    expect(
      await getAccessibleCopilotChatForCancellation(CHAT_ID, USER_ID, { principal: orgPrincipal })
    ).toEqual(orgChat)
    expect(mockAuthorizeCancellation).toHaveBeenCalledWith({
      principal: orgPrincipal,
      input: { organizationId: 'org-1' },
    })
    expect(mockAuthorizeOrganization).not.toHaveBeenCalled()
    expect(
      await getAccessibleCopilotChatAuth(CHAT_ID, USER_ID, { principal: orgPrincipal })
    ).toBeNull()
    expect(mockAuthorizeOrganization).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.orderBy).not.toHaveBeenCalled()
  })

  it('keeps the owned-live-chat predicate on cancellation', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([orgChat])
    await getAccessibleCopilotChatForCancellation(CHAT_ID, USER_ID, { principal: orgPrincipal })
    const predicate = dbChainMockFns.where.mock.calls[0][0] as { conditions: unknown[] }
    expect(predicate.conditions).toEqual([
      { type: 'eq', left: schemaMock.copilotChats.id, right: CHAT_ID },
      { type: 'eq', left: schemaMock.copilotChats.userId, right: USER_ID },
      { type: 'isNull', column: schemaMock.copilotChats.deletedAt },
    ])
  })

  it('denies cancellation after organization membership removal', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([orgChat])
    mockAuthorizeCancellation.mockRejectedValueOnce(
      new OrchestrationError('not_found', 'Organization not found')
    )
    expect(
      await getAccessibleCopilotChatForCancellation(CHAT_ID, USER_ID, { principal: orgPrincipal })
    ).toBeNull()
    expect(mockAuthorizeOrganization).not.toHaveBeenCalled()
  })

  it.each([undefined, { ...orgPrincipal, userId: 'other-user' }])(
    'denies cancellation without the matching actor principal',
    async (principal) => {
      dbChainMockFns.limit.mockResolvedValueOnce([orgChat])
      expect(
        await getAccessibleCopilotChatForCancellation(CHAT_ID, USER_ID, { principal })
      ).toBeNull()
      expect(mockAuthorizeCancellation).not.toHaveBeenCalled()
    }
  )

  it('does not let delegated cancellation switch to another chat owned by the same actor', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([orgChat])
    const principal = createTrustedOrganizationCopilotPrincipal(
      {
        userId: USER_ID,
        organizationId: 'org-1',
        chatId: 'other-chat',
        delegationId: 'request',
      },
      { audience: 'sim:copilot-cancel', ttlMs: 60000 }
    )
    expect(
      await getAccessibleCopilotChatForCancellation(CHAT_ID, USER_ID, { principal })
    ).toBeNull()
    expect(mockAuthorizeCancellation).not.toHaveBeenCalled()
  })

  it('denies missing/deleted/non-owned chats before authorizing cancellation', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])
    expect(
      await getAccessibleCopilotChatForCancellation(CHAT_ID, USER_ID, { principal: orgPrincipal })
    ).toBeNull()
    expect(mockAuthorizeCancellation).not.toHaveBeenCalled()
  })

  it('propagates cancellation authorization infrastructure errors', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([orgChat])
    mockAuthorizeCancellation.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(
      getAccessibleCopilotChatForCancellation(CHAT_ID, USER_ID, { principal: orgPrincipal })
    ).rejects.toThrow('database unavailable')
  })
})
