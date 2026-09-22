/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRunHeadlessCopilotLifecycle,
  mockAppendCopilotChatMessages,
  mockAcquirePendingChatStream,
  mockReleasePendingChatStream,
  mockPublishStatusChanged,
  mockCheckWorkspaceAccess,
  mockAuthorizeTaskWake,
  mockBuildIntegrationToolSchemas,
} = vi.hoisted(() => ({
  mockRunHeadlessCopilotLifecycle: vi.fn(),
  mockAppendCopilotChatMessages: vi.fn(),
  mockAcquirePendingChatStream: vi.fn(),
  mockReleasePendingChatStream: vi.fn(),
  mockPublishStatusChanged: vi.fn(),
  mockCheckWorkspaceAccess: vi.fn(),
  mockAuthorizeTaskWake: vi.fn(),
  mockBuildIntegrationToolSchemas: vi.fn(),
}))

vi.mock('@/lib/mothership/tasks/application/prepare-wake', () => ({
  authorizeTaskWake: mockAuthorizeTaskWake,
}))
vi.mock('@/lib/billing/core/billing-attribution', () => ({
  resolveBillingAttribution: vi.fn().mockResolvedValue({}),
  resolveOrganizationBillingAttribution: vi.fn().mockResolvedValue({}),
}))
vi.mock('@/lib/mothership/chat/messages-store', () => ({
  appendCopilotChatMessages: mockAppendCopilotChatMessages,
}))
vi.mock('@/lib/mothership/chat/payload', () => ({
  buildIntegrationToolSchemas: mockBuildIntegrationToolSchemas,
}))
vi.mock('@/lib/mothership/chat-status', () => ({
  chatPubSub: { publishStatusChanged: mockPublishStatusChanged },
}))
vi.mock('@/lib/mothership/request/lifecycle/headless', () => ({
  runHeadlessCopilotLifecycle: mockRunHeadlessCopilotLifecycle,
}))
vi.mock('@/lib/mothership/request/session/abort', () => ({
  acquirePendingChatStream: mockAcquirePendingChatStream,
  releasePendingChatStream: mockReleasePendingChatStream,
}))
vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: mockCheckWorkspaceAccess,
}))

import { ChatPayloadSchema } from '@/lib/mothership/generated/protocol'
import { runWakeTurn } from '@/lib/mothership/tasks/wake'

const WAKE = {
  taskId: '22222222-2222-4222-8222-222222222222',
  runId: '33333333-3333-4333-8333-333333333333',
  status: 'completed' as const,
  summary: 'Timer elapsed',
  chatId: 'chat-1',
  workspaceId: 'ws-1',
  userId: 'user-1',
  message:
    '[Background task notification — automated, not the user.]\nTask x completed: Timer elapsed',
}

describe('copilot task wake', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBuildIntegrationToolSchemas.mockResolvedValue([
      { name: 'gmail_search_v2', input_schema: { type: 'object' } },
    ])
    mockAuthorizeTaskWake.mockResolvedValue('agent')
    mockCheckWorkspaceAccess.mockResolvedValue({ permission: 'admin' })
    mockAcquirePendingChatStream.mockResolvedValue(true)
    mockRunHeadlessCopilotLifecycle.mockResolvedValue({
      success: true,
      content: 'TIMER FIRED',
      contentBlocks: [],
    })
  })

  it.each(['workspace', 'organization'])(
    'sends a valid %s wake without eagerly loading integration schemas',
    async (scope) => {
      const chatId = '44444444-4444-4444-8444-444444444444'
      const wake = {
        ...WAKE,
        chatId,
        workspaceId: scope === 'workspace' ? '55555555-5555-4555-8555-555555555555' : undefined,
        organizationId: scope === 'organization' ? 'organization-1' : undefined,
      }
      await runWakeTurn(wake)

      expect(mockRunHeadlessCopilotLifecycle).toHaveBeenCalledOnce()
      const [payload, options] = mockRunHeadlessCopilotLifecycle.mock.calls[0]
      expect(ChatPayloadSchema.parse(payload)).toMatchObject({
        message: WAKE.message,
        messageId: WAKE.runId,
        chatId,
        origin: 'task',
        ...(scope === 'workspace'
          ? { workspaceId: wake.workspaceId }
          : { organizationId: wake.organizationId, mode: 'agent' }),
      })
      expect(payload).not.toHaveProperty('integrationTools')
      expect(mockBuildIntegrationToolSchemas).not.toHaveBeenCalled()
      expect(options).toMatchObject({ interactive: false, autoExecuteTools: true })
      if (scope === 'organization') {
        expect(payload).not.toHaveProperty('workspaceId')
        expect(mockCheckWorkspaceAccess).not.toHaveBeenCalled()
      }
      expect(mockAppendCopilotChatMessages).toHaveBeenCalledOnce()
      expect(mockReleasePendingChatStream).toHaveBeenCalledWith(chatId, WAKE.runId)
    }
  )

  it('runs the headless turn under the reserved run id, persists both messages with the task origin, and announces it', async () => {
    await runWakeTurn(WAKE)
    expect(mockAcquirePendingChatStream).not.toHaveBeenCalled()
    expect(mockPublishStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'started', chatId: 'chat-1', streamId: WAKE.runId })
    )
    const [payload, options] = mockRunHeadlessCopilotLifecycle.mock.calls[0]
    expect(payload).toEqual(
      expect.objectContaining({
        message: WAKE.message,
        messageId: WAKE.runId,
        origin: 'task',
        chatId: 'chat-1',
      })
    )
    expect(options).toEqual(
      expect.objectContaining({ interactive: false, chatId: 'chat-1', userPermission: 'admin' })
    )
    const [chatId, messages, opts] = mockAppendCopilotChatMessages.mock.calls[0]
    expect(chatId).toBe('chat-1')
    expect(messages[0]).toEqual(
      expect.objectContaining({ role: 'user', id: WAKE.runId, origin: 'task' })
    )
    expect(messages[1]).toEqual(
      expect.objectContaining({ role: 'assistant', content: 'TIMER FIRED' })
    )
    expect(opts).toEqual({ streamId: WAKE.runId })
    expect(mockReleasePendingChatStream).toHaveBeenCalledWith('chat-1', WAKE.runId)
    expect(mockPublishStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'completed', chatId: 'chat-1', streamId: WAKE.runId })
    )
  })

  it('rechecks access before spending on a wake, and releases the reservation on failure', async () => {
    mockAuthorizeTaskWake.mockRejectedValue(new Error('Access revoked'))
    await runWakeTurn(WAKE)
    expect(mockRunHeadlessCopilotLifecycle).not.toHaveBeenCalled()
    expect(mockReleasePendingChatStream).toHaveBeenCalledWith('chat-1', WAKE.runId)
  })
  it('does not persist an empty turn when the wake was already consumed by a human turn', async () => {
    mockRunHeadlessCopilotLifecycle.mockResolvedValue({
      success: true,
      content: '',
      contentBlocks: [],
    })
    await runWakeTurn(WAKE)
    expect(mockAppendCopilotChatMessages).not.toHaveBeenCalled()
    expect(mockReleasePendingChatStream).toHaveBeenCalledWith('chat-1', WAKE.runId)
  })
})

it('preserves a Plan conversation when an explicitly requested task completes', async () => {
  mockAuthorizeTaskWake.mockResolvedValue('plan')
  await runWakeTurn({ ...WAKE, workspaceId: undefined, organizationId: 'org-plan' })
  expect(mockRunHeadlessCopilotLifecycle).toHaveBeenLastCalledWith(
    expect.objectContaining({ mode: 'plan', organizationId: 'org-plan' }),
    expect.objectContaining({ organizationId: 'org-plan' })
  )
})
