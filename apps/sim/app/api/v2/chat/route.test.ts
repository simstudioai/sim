/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAcquirePendingChatStream,
  mockCheckAttributedUsageLimits,
  mockCheckRateLimit,
  mockClearFilePreviewSessions,
  mockCleanupAbortMarker,
  mockCreateRunSegment,
  mockEnv,
  mockEnvFlags,
  mockFinalizeStream,
  mockFireTitleGeneration,
  mockGenerateId,
  mockGetAccessibleCopilotChatContinuationMetadata,
  mockIssueV2ChatContinuationToken,
  mockPersistCopilotUserMessage,
  mockPrepareV2ChatAttachments,
  mockPublishStatusChanged,
  mockPublisherClose,
  mockPublisherFlush,
  mockPublisherPublish,
  mockRegisterActiveStream,
  mockReleasePendingChatStream,
  mockResetBuffer,
  mockResolveOrCreateChat,
  mockRequestExplicitStreamAbort,
  mockResolveBillingAttribution,
  mockResolveSystemBillingAttribution,
  mockResolveWorkspaceAccess,
  mockRunWorkspaceChat,
  mockScheduleBufferCleanup,
  mockScheduleFilePreviewSessionCleanup,
  mockStartAbortPoller,
  mockStreamWriter,
  mockTurnOnComplete,
  mockTurnOnError,
  mockUnregisterActiveStream,
  mockVerifyV2ChatContinuationToken,
  mockV2ApiGateError,
} = vi.hoisted(() => ({
  mockAcquirePendingChatStream: vi.fn(),
  mockCheckAttributedUsageLimits: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockClearFilePreviewSessions: vi.fn(),
  mockCleanupAbortMarker: vi.fn(),
  mockCreateRunSegment: vi.fn(),
  mockEnv: { COPILOT_API_KEY: 'deployment-mothership-key' as string | undefined },
  mockEnvFlags: { isAuthDisabled: false },
  mockFinalizeStream: vi.fn(),
  mockFireTitleGeneration: vi.fn(),
  mockGenerateId: vi.fn(),
  mockGetAccessibleCopilotChatContinuationMetadata: vi.fn(),
  mockIssueV2ChatContinuationToken: vi.fn(),
  mockPersistCopilotUserMessage: vi.fn(),
  mockPrepareV2ChatAttachments: vi.fn(),
  mockPublishStatusChanged: vi.fn(),
  mockPublisherClose: vi.fn(),
  mockPublisherFlush: vi.fn(),
  mockPublisherPublish: vi.fn(),
  mockRegisterActiveStream: vi.fn(),
  mockReleasePendingChatStream: vi.fn(),
  mockResetBuffer: vi.fn(),
  mockResolveOrCreateChat: vi.fn(),
  mockRequestExplicitStreamAbort: vi.fn(),
  mockResolveBillingAttribution: vi.fn(),
  mockResolveSystemBillingAttribution: vi.fn(),
  mockResolveWorkspaceAccess: vi.fn(),
  mockRunWorkspaceChat: vi.fn(),
  mockScheduleBufferCleanup: vi.fn(),
  mockScheduleFilePreviewSessionCleanup: vi.fn(),
  mockStartAbortPoller: vi.fn(),
  mockStreamWriter: vi.fn(),
  mockTurnOnComplete: vi.fn(),
  mockTurnOnError: vi.fn(),
  mockUnregisterActiveStream: vi.fn(),
  mockVerifyV2ChatContinuationToken: vi.fn(),
  mockV2ApiGateError: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceAccess: mockResolveWorkspaceAccess,
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: mockV2ApiGateError,
}))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  checkAttributedUsageLimits: mockCheckAttributedUsageLimits,
  resolveBillingAttribution: mockResolveBillingAttribution,
  resolveSystemBillingAttribution: mockResolveSystemBillingAttribution,
}))

vi.mock('@/lib/copilot/async-runs/repository', () => ({
  createRunSegment: mockCreateRunSegment,
}))

vi.mock('@/lib/copilot/chat/lifecycle', () => ({
  getAccessibleCopilotChatContinuationMetadata: mockGetAccessibleCopilotChatContinuationMetadata,
  resolveOrCreateChat: mockResolveOrCreateChat,
}))

vi.mock('@/lib/copilot/chat/turn-persistence', () => ({
  buildCopilotTurnOnComplete: () => mockTurnOnComplete,
  buildCopilotTurnOnError: () => mockTurnOnError,
  persistCopilotUserMessage: mockPersistCopilotUserMessage,
}))

vi.mock('@/lib/copilot/chat-status', () => ({
  chatPubSub: { publishStatusChanged: mockPublishStatusChanged },
}))

vi.mock('@/lib/copilot/headless/workspace-chat', () => ({
  runWorkspaceChat: mockRunWorkspaceChat,
  publicChatUsageLimitMessage: (content: string) => {
    const match = /^<usage_upgrade>(.+)<\/usage_upgrade>$/.exec(content)
    if (!match) return null
    return (JSON.parse(match[1]) as { message: string }).message
  },
  toPublicChatResult: (
    result: { content: string; usage?: { prompt: number; completion: number } },
    continuationToken: string
  ) => ({
    content: result.content,
    continuationToken,
    usage: result.usage
      ? {
          prompt: result.usage.prompt,
          completion: result.usage.completion,
          total: result.usage.prompt + result.usage.completion,
        }
      : {},
  }),
}))

vi.mock('@/lib/copilot/headless/attachments', () => ({
  prepareV2ChatAttachments: mockPrepareV2ChatAttachments,
}))

vi.mock('@/lib/copilot/headless/continuation-token', () => ({
  issueV2ChatContinuationToken: mockIssueV2ChatContinuationToken,
  verifyV2ChatContinuationToken: mockVerifyV2ChatContinuationToken,
}))

vi.mock('@/lib/copilot/request/session/explicit-abort', () => ({
  requestExplicitStreamAbort: mockRequestExplicitStreamAbort,
}))

vi.mock('@/lib/copilot/request/lifecycle/finalize', () => ({
  finalizeStream: mockFinalizeStream,
}))

vi.mock('@/lib/copilot/request/lifecycle/start', () => ({
  fireTitleGeneration: mockFireTitleGeneration,
}))

vi.mock('@/lib/copilot/request/session', () => ({
  AbortReason: { UserStop: 'user_stop:abortActiveStream' },
  StreamWriter: mockStreamWriter,
  acquirePendingChatStream: mockAcquirePendingChatStream,
  clearFilePreviewSessions: mockClearFilePreviewSessions,
  cleanupAbortMarker: mockCleanupAbortMarker,
  encodeSSEComment: (comment: string) => new TextEncoder().encode(`: ${comment}\n\n`),
  encodeSSEEnvelope: (value: unknown) =>
    new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`),
  registerActiveStream: mockRegisterActiveStream,
  releasePendingChatStream: mockReleasePendingChatStream,
  resetBuffer: mockResetBuffer,
  scheduleBufferCleanup: mockScheduleBufferCleanup,
  scheduleFilePreviewSessionCleanup: mockScheduleFilePreviewSessionCleanup,
  SSE_RESPONSE_HEADERS: { 'Content-Type': 'text/event-stream' },
  startAbortPoller: mockStartAbortPoller,
  unregisterActiveStream: mockUnregisterActiveStream,
}))

vi.mock('@/lib/core/config/env', () => ({ env: mockEnv }))
vi.mock('@/lib/core/config/env-flags', () => mockEnvFlags)
vi.mock('@/lib/core/utils/request', () => ({ generateRequestId: () => 'request-1' }))

vi.mock('@sim/utils/id', () => ({ generateId: mockGenerateId }))

import { MAX_V2_CHAT_BODY_BYTES } from '@/lib/api/contracts/v2/chat'
import { POST } from '@/app/api/v2/chat/route'

const RATE_LIMIT = {
  allowed: true,
  userId: 'key-owner-1',
  keyType: 'personal' as const,
  limit: 100,
  remaining: 99,
  resetAt: new Date('2026-08-05T12:00:00.000Z'),
}

const personalAttribution = {
  actorUserId: 'key-owner-1',
  workspaceId: 'workspace-1',
  billedAccountUserId: 'payer-1',
  organizationId: null,
  billingEntity: { type: 'user' as const, id: 'payer-1' },
  billingPeriod: {
    start: '2026-08-01T00:00:00.000Z',
    end: '2026-09-01T00:00:00.000Z',
  },
  payerSubscription: null,
}

const systemAttribution = {
  ...personalAttribution,
  actorUserId: 'workspace-billed-account',
}

function callChat(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return POST(
    createMockRequest(
      'POST',
      body,
      { 'Content-Type': 'application/json', 'x-api-key': 'caller-platform-key', ...headers },
      'http://localhost:3000/api/v2/chat'
    )
  )
}

function parseSse(stream: string): Record<string, unknown>[] {
  return stream
    .split('\n')
    .filter((line) => line.startsWith('data: ') && line !== 'data: [DONE]')
    .map((line) => JSON.parse(line.slice('data: '.length)) as Record<string, unknown>)
}

describe('POST /api/v2/chat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnv.COPILOT_API_KEY = 'deployment-mothership-key'
    mockEnvFlags.isAuthDisabled = false
    mockGenerateId
      .mockReset()
      .mockReturnValueOnce('message-1')
      .mockReturnValueOnce('execution-1')
      .mockReturnValueOnce('run-1')
      .mockReturnValue('generated-extra')
    mockResolveOrCreateChat.mockResolvedValue({
      chatId: 'chat-1',
      chat: { id: 'chat-1', type: 'mothership', title: null },
      conversationHistory: [],
      isNew: true,
    })
    mockStreamWriter.mockImplementation(function MockStreamWriter() {
      return {
        close: mockPublisherClose,
        flush: mockPublisherFlush,
        publish: mockPublisherPublish,
        sawComplete: false,
      }
    })
    mockIssueV2ChatContinuationToken.mockReturnValue('continuation-new')
    mockGetAccessibleCopilotChatContinuationMetadata.mockResolvedValue(null)
    mockVerifyV2ChatContinuationToken.mockReturnValue({ valid: false })
    mockPrepareV2ChatAttachments.mockReturnValue({ success: true, attachments: [] })
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT)
    mockV2ApiGateError.mockResolvedValue(null)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockResolveBillingAttribution.mockResolvedValue(personalAttribution)
    mockResolveSystemBillingAttribution.mockResolvedValue(systemAttribution)
    mockCheckAttributedUsageLimits.mockResolvedValue({ isExceeded: false })
    mockAcquirePendingChatStream.mockResolvedValue(true)
    mockClearFilePreviewSessions.mockResolvedValue(undefined)
    mockCleanupAbortMarker.mockResolvedValue(undefined)
    mockCreateRunSegment.mockResolvedValue({ id: 'run-1' })
    mockFinalizeStream.mockResolvedValue(undefined)
    mockPersistCopilotUserMessage.mockResolvedValue(undefined)
    mockPublisherClose.mockResolvedValue(undefined)
    mockPublisherFlush.mockResolvedValue(undefined)
    mockReleasePendingChatStream.mockResolvedValue(undefined)
    mockResetBuffer.mockResolvedValue(undefined)
    mockRequestExplicitStreamAbort.mockResolvedValue(undefined)
    mockScheduleBufferCleanup.mockResolvedValue(undefined)
    mockScheduleFilePreviewSessionCleanup.mockResolvedValue(undefined)
    mockStartAbortPoller.mockReturnValue(0)
    mockRunWorkspaceChat.mockImplementation(async (input) => {
      input.onInitialStreamAccepted?.()
      await input.onEvent?.({
        type: 'text',
        payload: { channel: 'assistant', text: 'Hello from Sim' },
      })
      return {
        success: true,
        content: 'Hello from Sim',
        contentBlocks: [],
        toolCalls: [],
        usage: { prompt: 8, completion: 3 },
      }
    })
  })

  it('streams a personal-key chat and bills its authenticated actor', async () => {
    const response = await callChat({ workspaceId: 'workspace-1', prompt: 'What is here?' })
    const stream = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    expect(response.headers.get('x-ratelimit-remaining')).toBe('99')
    expect(stream).toContain('"type":"session"')
    expect(stream).toContain('"continuationToken":"continuation-new"')
    expect(stream).toContain('"chatId":"chat-1"')
    expect(stream).toContain('"delta":"Hello from Sim"')
    expect(stream).toContain('"type":"complete"')
    expect(stream).toContain('data: [DONE]')

    expect(mockResolveBillingAttribution).toHaveBeenCalledWith({
      actorUserId: 'key-owner-1',
      workspaceId: 'workspace-1',
    })
    expect(mockResolveSystemBillingAttribution).not.toHaveBeenCalled()
    expect(mockRunWorkspaceChat).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizationUserId: 'key-owner-1',
        actorUserId: 'key-owner-1',
        workspaceId: 'workspace-1',
        billingAttribution: personalAttribution,
        readOnly: false,
      })
    )
    expect(mockIssueV2ChatContinuationToken).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialType: 'personal',
        readOnly: false,
        persistence: 'sim',
      })
    )
    expect(mockRunWorkspaceChat.mock.calls[0][0]).not.toHaveProperty('apiKey')
    expect(mockAcquirePendingChatStream).toHaveBeenCalledWith('chat-1', 'message-1')
    expect(mockRegisterActiveStream).toHaveBeenCalledWith(
      'message-1',
      expect.any(AbortController),
      expect.any(AbortController)
    )
    expect(mockStartAbortPoller).toHaveBeenCalledWith('message-1', expect.any(AbortController), {
      requestId: 'request-1',
      chatId: 'chat-1',
      userStopController: expect.any(AbortController),
    })
    expect(mockUnregisterActiveStream).toHaveBeenCalledWith('message-1')
    expect(mockReleasePendingChatStream).toHaveBeenCalledWith('chat-1', 'message-1')
    expect(mockCleanupAbortMarker).toHaveBeenCalledWith('message-1')
    expect(mockResolveOrCreateChat).toHaveBeenCalledWith({
      userId: 'key-owner-1',
      workspaceId: 'workspace-1',
      model: 'claude-opus-4-8',
      type: 'mothership',
    })
    expect(mockPublishStatusChanged).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      type: 'created',
    })
    expect(mockCreateRunSegment).toHaveBeenCalledWith({
      id: 'run-1',
      executionId: 'execution-1',
      chatId: 'chat-1',
      userId: 'key-owner-1',
      workspaceId: 'workspace-1',
      streamId: 'message-1',
      model: null,
      requestContext: { requestId: 'request-1', source: 'v2_chat' },
    })
    expect(mockResetBuffer).toHaveBeenCalledWith('message-1')
    expect(mockClearFilePreviewSessions).toHaveBeenCalledWith('message-1')
    expect(mockPersistCopilotUserMessage).toHaveBeenCalledWith({
      chatId: 'chat-1',
      userMessageId: 'message-1',
      message: 'What is here?',
      contexts: undefined,
      workspaceId: 'workspace-1',
      notifyWorkspaceStatus: true,
    })
    expect(mockPublisherPublish).toHaveBeenCalledWith({
      type: 'session',
      payload: { kind: 'chat', chatId: 'chat-1' },
    })
    expect(mockPublisherPublish).toHaveBeenCalledWith({
      type: 'text',
      payload: { channel: 'assistant', text: 'Hello from Sim' },
    })
    expect(mockFinalizeStream).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, content: 'Hello from Sim' }),
      expect.any(Object),
      'run-1',
      'success',
      'request-1'
    )
    expect(mockFireTitleGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 'chat-1',
        isNewChat: true,
        message: 'What is here?',
        workspaceId: 'workspace-1',
      })
    )
    expect(mockPublisherClose).toHaveBeenCalledTimes(1)
    expect(mockScheduleBufferCleanup).toHaveBeenCalledWith('message-1')
    expect(mockScheduleFilePreviewSessionCleanup).toHaveBeenCalledWith('message-1')
  })

  it('passes validated resource and slash contexts to workspace chat', async () => {
    const contexts = [
      { kind: 'workflow', workflowId: 'workflow-1', label: 'Release' },
      { kind: 'skill', skillId: 'skill-1', label: 'review' },
      { kind: 'mcp', serverId: 'mcp-1', label: 'Docs' },
    ]
    const response = await callChat({
      workspaceId: 'workspace-1',
      prompt: 'Use @Release and /review with /Docs',
      contexts,
    })
    await response.text()

    expect(response.status).toBe(200)
    expect(mockRunWorkspaceChat).toHaveBeenCalledWith(expect.objectContaining({ contexts }))
  })

  it('rejects malformed or unsupported public context variants', async () => {
    const response = await callChat({
      workspaceId: 'workspace-1',
      prompt: 'Use this',
      contexts: [{ kind: 'folder', folderId: 'folder-1', label: 'Private folder' }],
    })

    expect(response.status).toBe(400)
    expect(mockRunWorkspaceChat).not.toHaveBeenCalled()
  })

  it('fails with a retryable conflict before exposing a session when the chat lease is busy', async () => {
    mockAcquirePendingChatStream.mockResolvedValueOnce(false)

    const response = await callChat({ workspaceId: 'workspace-1', prompt: 'Tell me more' })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: {
        code: 'CONFLICT',
        message: 'A response is already in progress for this chat',
      },
    })
    expect(mockIssueV2ChatContinuationToken).not.toHaveBeenCalled()
    expect(mockRegisterActiveStream).not.toHaveBeenCalled()
    expect(mockRunWorkspaceChat).not.toHaveBeenCalled()
    expect(mockReleasePendingChatStream).not.toHaveBeenCalled()
  })

  it('does not issue a session token or start Mothership before the chat lease is acquired', async () => {
    let acquire!: (value: boolean) => void
    mockAcquirePendingChatStream.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        acquire = resolve
      })
    )

    const pendingResponse = callChat({ workspaceId: 'workspace-1', prompt: 'Tell me more' })
    await new Promise((resolve) => setImmediate(resolve))

    expect(mockIssueV2ChatContinuationToken).not.toHaveBeenCalled()
    expect(mockRunWorkspaceChat).not.toHaveBeenCalled()

    acquire(true)
    const response = await pendingResponse
    const stream = await response.text()
    expect(stream).toContain('"type":"session"')
    expect(mockRunWorkspaceChat).toHaveBeenCalledTimes(1)
  })

  it('does not expose the continuation token until Go accepts the initial stream', async () => {
    let accept!: () => void
    let settle!: () => void
    mockFireTitleGeneration.mockImplementationOnce(
      ({ publisher }: { publisher: { publish: (event: unknown) => void } }) => {
        publisher.publish({
          type: 'session',
          payload: { kind: 'title', title: 'Release investigation' },
        })
      }
    )
    mockRunWorkspaceChat.mockImplementationOnce(
      (input) =>
        new Promise((resolve) => {
          accept = () => input.onInitialStreamAccepted?.()
          settle = () =>
            resolve({
              success: true,
              content: 'Done',
              contentBlocks: [],
              toolCalls: [],
            })
        })
    )

    const response = await callChat({ workspaceId: 'workspace-1', prompt: 'Tell me more' })
    const reader = response.body!.getReader()
    let firstReadSettled = false
    const firstRead = reader.read().then((result) => {
      firstReadSettled = true
      return result
    })
    await new Promise((resolve) => setImmediate(resolve))
    expect(firstReadSettled).toBe(false)

    accept()
    const first = await firstRead
    const acceptedSession = new TextDecoder().decode(first.value)
    expect(acceptedSession).toContain('"type":"session"')
    expect(acceptedSession).toContain('"continuationToken":"continuation-new"')
    expect(acceptedSession).toContain('"title":"Release investigation"')
    expect(mockPublisherPublish).toHaveBeenCalledWith({
      type: 'session',
      payload: { kind: 'title', title: 'Release investigation' },
    })

    settle()
    while (!(await reader.read()).done) {
      // Drain the completion so route cleanup can release its lease.
    }
    await vi.waitFor(() => expect(mockReleasePendingChatStream).toHaveBeenCalledTimes(1))
  })

  it('projects a title generated after session acceptance onto the public stream', async () => {
    let publishTitle!: (event: unknown) => void
    mockFireTitleGeneration.mockImplementationOnce(
      ({ publisher }: { publisher: { publish: (event: unknown) => void } }) => {
        publishTitle = publisher.publish
      }
    )
    mockRunWorkspaceChat.mockImplementationOnce(async (input) => {
      input.onInitialStreamAccepted?.()
      publishTitle({
        type: 'session',
        payload: { kind: 'title', title: 'Deployment failure' },
      })
      return {
        success: true,
        content: 'Done',
        contentBlocks: [],
        toolCalls: [],
      }
    })

    const response = await callChat({ workspaceId: 'workspace-1', prompt: 'What failed?' })
    const events = parseSse(await response.text())

    expect(events).toContainEqual({
      type: 'session',
      chatId: 'chat-1',
      title: 'Deployment failure',
    })
  })

  it('does not hold the Go leg on run-segment creation but waits before finalizing it', async () => {
    let resolveRunSegment!: () => void
    let resolveChat!: () => void
    mockCreateRunSegment.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRunSegment = () => resolve({ id: 'run-1' })
      })
    )
    mockRunWorkspaceChat.mockImplementationOnce(
      (input) =>
        new Promise((resolve) => {
          input.onInitialStreamAccepted?.()
          resolveChat = () =>
            resolve({
              success: true,
              content: 'Done',
              contentBlocks: [],
              toolCalls: [],
            })
        })
    )

    const response = await callChat({ workspaceId: 'workspace-1', prompt: 'Continue' })
    await vi.waitFor(() => expect(mockRunWorkspaceChat).toHaveBeenCalledTimes(1))

    resolveChat()
    await new Promise((resolve) => setImmediate(resolve))
    expect(mockFinalizeStream).not.toHaveBeenCalled()

    resolveRunSegment()
    expect(await response.text()).toContain('"type":"complete"')
    expect(mockFinalizeStream).toHaveBeenCalledTimes(1)
  })

  it('keeps a synced turn working when run-segment creation fails', async () => {
    mockCreateRunSegment.mockRejectedValueOnce(new Error('run table unavailable'))

    const response = await callChat({ workspaceId: 'workspace-1', prompt: 'Continue' })
    const stream = await response.text()

    expect(response.status).toBe(200)
    expect(stream).toContain('"type":"complete"')
    expect(mockFinalizeStream).toHaveBeenCalledTimes(1)
  })

  it('surfaces a pre-acceptance failure without exposing a continuation token', async () => {
    mockRunWorkspaceChat.mockResolvedValueOnce({
      success: false,
      content: '',
      contentBlocks: [],
      toolCalls: [],
      error: 'workspace setup failed',
    })

    const response = await callChat({ workspaceId: 'workspace-1', prompt: 'Tell me more' })
    const stream = await response.text()

    expect(stream).not.toContain('"type":"session"')
    expect(stream).toContain('"code":"INTERNAL_ERROR"')
  })

  it('enables the subtractive query policy only when explicitly requested', async () => {
    const response = await callChat({
      workspaceId: 'workspace-1',
      prompt: 'Only inspect this workspace',
      readOnly: true,
    })
    await response.text()

    expect(response.status).toBe(200)
    expect(mockRunWorkspaceChat).toHaveBeenCalledWith(expect.objectContaining({ readOnly: true }))
    expect(mockIssueV2ChatContinuationToken).toHaveBeenCalledWith(
      expect.objectContaining({ credentialType: 'personal', readOnly: true })
    )
  })

  it('continues a legacy Go-only chat without exposing or partially persisting it', async () => {
    mockVerifyV2ChatContinuationToken.mockReturnValueOnce({
      valid: true,
      chatId: 'private-chat-id',
    })
    mockIssueV2ChatContinuationToken.mockReturnValueOnce('continuation-refreshed')
    mockGenerateId.mockReset().mockReturnValue('message-followup')

    const response = await callChat({
      workspaceId: 'workspace-1',
      prompt: 'Tell me more',
      continuationToken: 'continuation-old',
    })
    const stream = await response.text()

    expect(response.status).toBe(200)
    expect(mockVerifyV2ChatContinuationToken).toHaveBeenCalledWith('continuation-old', {
      workspaceId: 'workspace-1',
      authorizationUserId: 'key-owner-1',
      credentialType: 'personal',
      readOnly: false,
    })
    expect(mockIssueV2ChatContinuationToken).toHaveBeenCalledWith({
      chatId: 'private-chat-id',
      workspaceId: 'workspace-1',
      authorizationUserId: 'key-owner-1',
      credentialType: 'personal',
      readOnly: false,
    })
    expect(mockRunWorkspaceChat).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 'private-chat-id',
        messageId: 'message-followup',
      })
    )
    expect(stream).toContain('"continuationToken":"continuation-refreshed"')
    expect(stream).not.toContain('private-chat-id')
    expect(mockGetAccessibleCopilotChatContinuationMetadata).toHaveBeenCalledWith(
      'private-chat-id',
      'key-owner-1'
    )
    expect(mockStreamWriter).not.toHaveBeenCalled()
    expect(mockPersistCopilotUserMessage).not.toHaveBeenCalled()
    expect(mockPublishStatusChanged).not.toHaveBeenCalled()
  })

  it('continues an existing persisted personal chat with UI replay enabled', async () => {
    mockVerifyV2ChatContinuationToken.mockReturnValueOnce({
      valid: true,
      chatId: 'shared-chat-1',
    })
    mockIssueV2ChatContinuationToken.mockReturnValueOnce('continuation-refreshed')
    mockGetAccessibleCopilotChatContinuationMetadata.mockResolvedValueOnce({
      id: 'shared-chat-1',
      userId: 'key-owner-1',
      workflowId: null,
      workspaceId: 'workspace-1',
      type: 'mothership',
      title: 'Existing chat',
      hasMessages: true,
      mcpServerIds: ['mcp-history'],
    })
    mockGenerateId
      .mockReset()
      .mockReturnValueOnce('message-followup')
      .mockReturnValueOnce('execution-followup')
      .mockReturnValueOnce('run-followup')

    const response = await callChat({
      workspaceId: 'workspace-1',
      prompt: 'Continue',
      continuationToken: 'continuation-old',
      contexts: [{ kind: 'mcp', serverId: 'mcp-current', label: 'Current' }],
    })
    const stream = await response.text()

    expect(response.status).toBe(200)
    expect(stream).toContain('"chatId":"shared-chat-1"')
    expect(mockPersistCopilotUserMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 'shared-chat-1',
        userMessageId: 'message-followup',
        message: 'Continue',
        contexts: [{ kind: 'mcp', serverId: 'mcp-current', label: 'Current' }],
      })
    )
    expect(mockRunWorkspaceChat).toHaveBeenCalledWith(
      expect.objectContaining({
        mcpServerIds: ['mcp-history'],
        contexts: [{ kind: 'mcp', serverId: 'mcp-current', label: 'Current' }],
      })
    )
    expect(mockCreateRunSegment).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'run-followup',
        executionId: 'execution-followup',
        chatId: 'shared-chat-1',
      })
    )
    expect(mockIssueV2ChatContinuationToken).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 'shared-chat-1', persistence: 'sim' })
    )
  })

  it.each([
    ['missing or deleted', null],
    [
      'the wrong type',
      {
        id: 'synced-chat-1',
        userId: 'key-owner-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        type: 'copilot',
        title: 'Workflow chat',
        hasMessages: true,
      },
    ],
    [
      'from another workspace',
      {
        id: 'synced-chat-1',
        userId: 'key-owner-1',
        workflowId: null,
        workspaceId: 'workspace-2',
        type: 'mothership',
        title: 'Other workspace',
        hasMessages: true,
      },
    ],
  ])('rejects an explicitly Sim-persisted continuation when its row is %s', async (_case, chat) => {
    mockVerifyV2ChatContinuationToken.mockReturnValueOnce({
      valid: true,
      chatId: 'synced-chat-1',
      persistence: 'sim',
    })
    mockGetAccessibleCopilotChatContinuationMetadata.mockResolvedValueOnce(chat)

    const response = await callChat({
      workspaceId: 'workspace-1',
      prompt: 'Continue',
      continuationToken: 'continuation-sim',
    })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Chat not found' },
    })
    expect(mockResolveBillingAttribution).not.toHaveBeenCalled()
    expect(mockIssueV2ChatContinuationToken).not.toHaveBeenCalled()
    expect(mockRunWorkspaceChat).not.toHaveBeenCalled()
  })

  it('fails closed before billing or Mothership for an invalid continuation token', async () => {
    mockVerifyV2ChatContinuationToken.mockReturnValueOnce({ valid: false })

    const response = await callChat({
      workspaceId: 'workspace-1',
      prompt: 'steal history',
      continuationToken: 'tampered-or-cross-owner-token',
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: { code: 'BAD_REQUEST', message: 'Invalid or expired continuation token' },
    })
    expect(mockResolveBillingAttribution).not.toHaveBeenCalled()
    expect(mockRunWorkspaceChat).not.toHaveBeenCalled()
  })

  it('validates inline attachments and forwards only the server-mapped Mothership shape', async () => {
    const publicAttachment = {
      name: 'notes.txt',
      mediaType: 'text/plain',
      data: 'aGk=',
    }
    const mothershipAttachment = {
      type: 'document',
      filename: 'notes.txt',
      source: { type: 'base64', media_type: 'text/plain', data: 'aGk=' },
    }
    mockPrepareV2ChatAttachments.mockReturnValueOnce({
      success: true,
      attachments: [mothershipAttachment],
    })

    const response = await callChat({
      workspaceId: 'workspace-1',
      prompt: 'Read this',
      attachments: [publicAttachment],
    })
    await response.text()

    expect(response.status).toBe(200)
    expect(mockPrepareV2ChatAttachments).toHaveBeenCalledWith([publicAttachment])
    expect(mockRunWorkspaceChat).toHaveBeenCalledWith(
      expect.objectContaining({ fileAttachments: [mothershipAttachment] })
    )
  })

  it('normalizes an attachment-only turn to a neutral upstream prompt', async () => {
    mockPrepareV2ChatAttachments.mockReturnValueOnce({
      success: true,
      attachments: [
        {
          type: 'document',
          filename: 'notes.txt',
          source: { type: 'base64', media_type: 'text/plain', data: 'aGk=' },
        },
      ],
    })

    const response = await callChat({
      workspaceId: 'workspace-1',
      prompt: '   ',
      attachments: [{ name: 'notes.txt', mediaType: 'text/plain', data: 'aGk=' }],
    })
    await response.text()

    expect(response.status).toBe(200)
    expect(mockRunWorkspaceChat).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'Please inspect the attached file(s).' })
    )
    expect(mockPersistCopilotUserMessage).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Please inspect the attached file(s).' })
    )
  })

  it('returns a typed HTTP error before billing when attachment validation fails', async () => {
    mockPrepareV2ChatAttachments.mockReturnValueOnce({
      success: false,
      error: {
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'Attachment "clip.mp4" has unsupported media type video/mp4',
      },
    })

    const response = await callChat({
      workspaceId: 'workspace-1',
      prompt: 'Watch this',
      attachments: [{ name: 'clip.mp4', mediaType: 'video/mp4', data: 'AAAA' }],
    })

    expect(response.status).toBe(415)
    expect((await response.json()).error.code).toBe('UNSUPPORTED_MEDIA_TYPE')
    expect(mockResolveBillingAttribution).not.toHaveBeenCalled()
    expect(mockRunWorkspaceChat).not.toHaveBeenCalled()
  })

  it('returns the v2 payload-too-large envelope for an oversized raw body', async () => {
    const response = await callChat(
      { workspaceId: 'workspace-1', prompt: 'hello' },
      { 'Content-Length': String(MAX_V2_CHAT_BODY_BYTES + 1) }
    )

    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: `Request body exceeds the ${MAX_V2_CHAT_BODY_BYTES}-byte limit`,
      },
    })
    expect(mockResolveWorkspaceAccess).not.toHaveBeenCalled()
    expect(mockResolveBillingAttribution).not.toHaveBeenCalled()
    expect(mockRunWorkspaceChat).not.toHaveBeenCalled()
  })

  it('forwards Mothership text events as deltas without prefix guessing', async () => {
    mockRunWorkspaceChat.mockImplementationOnce(async (input) => {
      input.onInitialStreamAccepted?.()
      await input.onEvent?.({
        type: 'text',
        payload: { channel: 'assistant', text: 'a' },
      })
      // This delta starts with all prior output. Treating events as possibly
      // cumulative would incorrectly emit only "bc" here.
      await input.onEvent?.({
        type: 'text',
        payload: { channel: 'assistant', text: 'abc' },
      })
      return {
        success: true,
        content: 'aabc',
        contentBlocks: [],
        toolCalls: [],
      }
    })

    const response = await callChat({ workspaceId: 'workspace-1', prompt: 'hello' })
    const stream = await response.text()

    expect(stream).toContain('"delta":"a"')
    expect(stream).toContain('"delta":"abc"')
    expect(stream).not.toContain('"delta":"bc"')
  })

  it('projects scoped assistant narration without merging it into the public answer', async () => {
    mockRunWorkspaceChat.mockImplementationOnce(async (input) => {
      input.onInitialStreamAccepted?.()
      await input.onEvent?.({
        type: 'span',
        scope: {
          lane: 'subagent',
          agentId: 'research',
          parentToolCallId: 'private-dispatch',
          spanId: 'private-span',
          parentSpanId: 'main',
        },
        payload: { kind: 'subagent', event: 'start', agent: 'research' },
      })
      await input.onEvent?.({
        type: 'text',
        scope: {
          lane: 'subagent',
          agentId: 'research',
          parentToolCallId: 'private-dispatch',
          spanId: 'private-span',
          parentSpanId: 'main',
        },
        payload: { channel: 'assistant', text: 'Scoped progress.' },
      })
      await input.onEvent?.({
        type: 'span',
        scope: {
          lane: 'subagent',
          agentId: 'research',
          parentToolCallId: 'private-dispatch',
          spanId: 'private-span',
          parentSpanId: 'main',
        },
        payload: { kind: 'subagent', event: 'end', agent: 'research' },
      })
      await input.onEvent?.({
        type: 'text',
        payload: { channel: 'assistant', text: 'public final delta' },
      })
      return {
        success: true,
        content: 'public final delta',
        contentBlocks: [],
        toolCalls: [],
      }
    })

    const response = await callChat({ workspaceId: 'workspace-1', prompt: 'hello' })
    const stream = await response.text()
    const events = parseSse(stream)
    const activities = events.filter((event) => event.type === 'activity')
    const answerText = events.filter((event) => event.type === 'text')

    expect(answerText).toEqual([{ type: 'text', delta: 'public final delta' }])
    expect(activities).toEqual([
      {
        type: 'activity',
        data: {
          kind: 'subagent',
          id: 'agent-1',
          label: 'Research Agent',
          state: 'running',
        },
      },
      {
        type: 'activity',
        data: { kind: 'narration', parentId: 'agent-1', delta: 'Scoped progress.' },
      },
      {
        type: 'activity',
        data: {
          kind: 'subagent',
          id: 'agent-1',
          label: 'Research Agent',
          state: 'complete',
        },
      },
    ])
    expect(stream).not.toContain('private-dispatch')
    expect(stream).not.toContain('private-span')
  })

  it('projects a display-safe nested activity tree without private stream data', async () => {
    mockRunWorkspaceChat.mockImplementationOnce(async (input) => {
      input.onInitialStreamAccepted?.()
      await input.onEvent?.({
        type: 'text',
        payload: { channel: 'thinking', text: 'Inspecting the workspace' },
      })
      await input.onEvent?.({
        type: 'tool',
        payload: {
          phase: 'call',
          toolCallId: 'private-tool-id',
          toolName: 'read',
          arguments: { secret: 'never-forward-me' },
          executor: 'sim',
          mode: 'async',
        },
      })
      await input.onEvent?.({
        type: 'tool',
        payload: {
          phase: 'call',
          toolCallId: 'hidden-tool-id',
          toolName: 'private_hidden_tool',
          arguments: { secret: 'hidden-call-secret' },
          executor: 'sim',
          mode: 'async',
          ui: { hidden: true },
        },
      })
      await input.onEvent?.({
        type: 'tool',
        payload: {
          phase: 'result',
          toolCallId: 'hidden-tool-id',
          toolName: 'private_hidden_tool',
          output: { secret: 'hidden-result-secret' },
          success: true,
          executor: 'sim',
          mode: 'async',
        },
      })
      await input.onEvent?.({
        type: 'tool',
        scope: {
          lane: 'subagent',
          agentId: 'research',
          parentToolCallId: 'private-tool-id',
          spanId: 'private-research-span',
          parentSpanId: 'main',
        },
        payload: {
          phase: 'call',
          toolCallId: 'scoped-tool-id',
          toolName: 'private_scoped_tool',
          arguments: { secret: 'scoped-secret' },
          executor: 'sim',
          mode: 'async',
        },
      })
      await input.onEvent?.({
        type: 'tool',
        scope: {
          lane: 'subagent',
          agentId: 'research',
          parentToolCallId: 'private-tool-id',
          spanId: 'private-research-span',
          parentSpanId: 'main',
        },
        payload: {
          phase: 'result',
          toolCallId: 'scoped-tool-id',
          toolName: 'private_scoped_tool',
          output: { secret: 'scoped-result-secret' },
          success: true,
          executor: 'sim',
          mode: 'async',
        },
      })
      await input.onEvent?.({
        type: 'span',
        scope: {
          lane: 'subagent',
          agentId: 'research',
          parentToolCallId: 'private-tool-id',
          spanId: 'private-research-span',
          parentSpanId: 'main',
        },
        payload: { kind: 'subagent', event: 'start', agent: 'research' },
      })
      await input.onEvent?.({
        type: 'text',
        scope: {
          lane: 'subagent',
          agentId: 'research',
          parentToolCallId: 'private-tool-id',
          spanId: 'private-research-span',
          parentSpanId: 'main',
        },
        payload: { channel: 'thinking', text: 'private subagent reasoning' },
      })
      await input.onEvent?.({
        type: 'span',
        scope: {
          lane: 'subagent',
          agentId: 'research',
          parentToolCallId: 'private-tool-id',
          spanId: 'private-research-span',
          parentSpanId: 'main',
        },
        payload: { kind: 'subagent', event: 'end', agent: 'research' },
      })
      await input.onEvent?.({
        type: 'tool',
        payload: {
          phase: 'result',
          toolCallId: 'private-tool-id',
          toolName: 'read',
          output: { secret: 'never-forward-me' },
          success: true,
          executor: 'sim',
          mode: 'async',
        },
      })
      return {
        success: true,
        content: 'Done',
        contentBlocks: [],
        toolCalls: [],
      }
    })

    const response = await callChat({ workspaceId: 'workspace-1', prompt: 'hello' })
    const stream = await response.text()

    expect(stream).toContain('"type":"complete"')
    expect(stream).toContain('Done')
    expect(stream).toContain('"type":"activity"')
    expect(stream).toContain('"label":"Reading file"')
    expect(stream).toContain('"label":"Read file"')
    expect(stream).toContain('"label":"Research Agent"')
    expect(stream).toContain('"label":"Private Scoped Tool"')
    expect(stream).toContain('"parentId":"agent-1"')
    expect(stream).toContain('"state":"running"')
    expect(stream).toContain('"state":"complete"')
    expect(stream.match(/"type":"activity"/g)).toHaveLength(6)
    expect(stream).not.toContain('Inspecting the workspace')
    expect(stream).not.toContain('private-tool-id')
    expect(stream).not.toContain('private_hidden_tool')
    expect(stream).not.toContain('private_scoped_tool')
    expect(stream).not.toContain('private-research-span')
    expect(stream).not.toContain('never-forward-me')
    expect(stream).not.toContain('scoped-secret')
    expect(stream).not.toContain('scoped-result-secret')
    expect(stream).not.toContain('private subagent reasoning')
  })

  it('authorizes a workspace key as its creator but executes and bills as the system actor', async () => {
    mockGenerateId
      .mockReset()
      .mockReturnValueOnce('chat-1')
      .mockReturnValueOnce('message-1')
      .mockReturnValue('generated-extra')
    mockCheckRateLimit.mockResolvedValue({
      ...RATE_LIMIT,
      keyType: 'workspace',
      workspaceId: 'workspace-1',
    })

    const response = await callChat({ workspaceId: 'workspace-1', prompt: 'Summarize it' })
    const stream = await response.text()

    expect(response.status).toBe(200)
    expect(mockResolveWorkspaceAccess).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'key-owner-1', keyType: 'workspace' }),
      'key-owner-1',
      'workspace-1',
      'read'
    )
    expect(mockResolveSystemBillingAttribution).toHaveBeenCalledWith('workspace-1')
    expect(mockResolveBillingAttribution).not.toHaveBeenCalled()
    expect(mockIssueV2ChatContinuationToken).toHaveBeenCalledWith(
      expect.objectContaining({ credentialType: 'workspace', readOnly: false })
    )
    expect(mockRunWorkspaceChat).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizationUserId: 'key-owner-1',
        actorUserId: 'workspace-billed-account',
        billingAttribution: systemAttribution,
        sharedWorkspaceCredential: true,
      })
    )
    expect(stream).not.toContain('"chatId":"chat-1"')
    expect(mockResolveOrCreateChat).not.toHaveBeenCalled()
    expect(mockStreamWriter).not.toHaveBeenCalled()
    expect(mockPersistCopilotUserMessage).not.toHaveBeenCalled()
    expect(mockPublishStatusChanged).not.toHaveBeenCalled()
  })

  it('routes a workspace-key abort by its owner while preserving the billing actor body', async () => {
    mockGenerateId
      .mockReset()
      .mockReturnValueOnce('chat-1')
      .mockReturnValueOnce('message-1')
      .mockReturnValue('generated-extra')
    mockCheckRateLimit.mockResolvedValue({
      ...RATE_LIMIT,
      keyType: 'workspace',
      workspaceId: 'workspace-1',
    })
    mockRunWorkspaceChat.mockResolvedValueOnce({
      success: false,
      content: '',
      contentBlocks: [],
      toolCalls: [],
      error: 'upstream failed',
    })

    const response = await callChat({ workspaceId: 'workspace-1', prompt: 'Summarize it' })
    await response.text()

    expect(mockRunWorkspaceChat).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizationUserId: 'key-owner-1',
        actorUserId: 'workspace-billed-account',
        billingAttribution: systemAttribution,
      })
    )
    expect(mockRequestExplicitStreamAbort).toHaveBeenCalledWith({
      streamId: 'message-1',
      userId: 'workspace-billed-account',
      routingUserId: 'key-owner-1',
      chatId: 'chat-1',
      workspaceId: 'workspace-1',
    })
  })

  it('supports the auth-disabled self-host principal while keeping upstream auth server-owned', async () => {
    const anonymousAttribution = {
      ...personalAttribution,
      actorUserId: 'anonymous',
    }
    mockCheckRateLimit.mockResolvedValue({
      ...RATE_LIMIT,
      userId: 'anonymous',
      keyType: 'personal',
    })
    mockEnvFlags.isAuthDisabled = true
    mockResolveBillingAttribution.mockResolvedValue(anonymousAttribution)

    const response = await callChat({ workspaceId: 'workspace-1', prompt: 'What is here?' })
    const stream = await response.text()

    expect(response.status).toBe(200)
    expect(mockResolveWorkspaceAccess).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'anonymous', keyType: undefined }),
      'anonymous',
      'workspace-1',
      'read'
    )
    expect(mockResolveBillingAttribution).toHaveBeenCalledWith({
      actorUserId: 'anonymous',
      workspaceId: 'workspace-1',
    })
    expect(mockRunWorkspaceChat).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizationUserId: 'anonymous',
        actorUserId: 'anonymous',
        billingAttribution: anonymousAttribution,
      })
    )
    expect(stream).toContain('"chatId":"chat-1"')
    expect(mockPersistCopilotUserMessage).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 'chat-1', message: 'What is here?' })
    )
  })

  it('returns 402 before opening a stream or calling Mothership when usage is exhausted', async () => {
    mockCheckAttributedUsageLimits.mockResolvedValue({
      isExceeded: true,
      message: 'Organization usage limit exceeded',
    })

    const response = await callChat({ workspaceId: 'workspace-1', prompt: 'hello' })

    expect(response.status).toBe(402)
    expect(await response.json()).toEqual({
      error: { code: 'USAGE_LIMIT_EXCEEDED', message: 'Organization usage limit exceeded' },
    })
    expect(mockRunWorkspaceChat).not.toHaveBeenCalled()
  })

  it('surfaces a raced or self-hosted upstream 402 as a structured stream error', async () => {
    const upgrade =
      '<usage_upgrade>{"reason":"usage_limit","action":"increase_limit","message":"Ask an org admin."}</usage_upgrade>'
    mockRunWorkspaceChat.mockImplementationOnce(async (input) => {
      await input.onEvent?.({
        type: 'text',
        payload: { channel: 'assistant', text: upgrade },
      })
      return {
        success: true,
        content: upgrade,
        contentBlocks: [],
        toolCalls: [],
      }
    })

    const response = await callChat({ workspaceId: 'workspace-1', prompt: 'hello' })
    const stream = await response.text()

    expect(response.status).toBe(200)
    expect(stream).toContain('"code":"USAGE_LIMIT_EXCEEDED"')
    expect(stream).toContain('Ask an org admin.')
    expect(stream).not.toContain('<usage_upgrade>')
    expect(stream).not.toContain('"type":"complete"')
  })

  it('rejects a cross-workspace key before resolving a payer', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue({
      status: 403,
      code: 'FORBIDDEN',
      message: 'API key is not authorized for this workspace',
    })

    const response = await callChat({ workspaceId: 'workspace-2', prompt: 'hello' })

    expect(response.status).toBe(403)
    expect(mockResolveBillingAttribution).not.toHaveBeenCalled()
    expect(mockResolveSystemBillingAttribution).not.toHaveBeenCalled()
    expect(mockRunWorkspaceChat).not.toHaveBeenCalled()
  })

  it('returns a clear 503 when the deployment has no Mothership key', async () => {
    mockEnv.COPILOT_API_KEY = undefined

    const response = await callChat({ workspaceId: 'workspace-1', prompt: 'hello' })

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Sim Chat is not configured on this deployment',
      },
    })
    expect(mockResolveBillingAttribution).not.toHaveBeenCalled()
  })

  it('does not leak an upstream failure body and explicitly stops detached generation', async () => {
    mockRunWorkspaceChat.mockResolvedValueOnce({
      success: false,
      content: '',
      contentBlocks: [],
      toolCalls: [],
      error: 'upstream secret response body',
      errors: ['provider internal detail'],
    })

    const response = await callChat({ workspaceId: 'workspace-1', prompt: 'hello' })
    const stream = await response.text()

    expect(stream).toContain('"code":"INTERNAL_ERROR"')
    expect(stream).toContain('"message":"Chat request failed"')
    expect(stream).not.toContain('upstream secret response body')
    expect(stream).not.toContain('provider internal detail')
    expect(mockRequestExplicitStreamAbort).toHaveBeenCalledTimes(1)
    expect(mockRequestExplicitStreamAbort).toHaveBeenCalledWith({
      streamId: 'message-1',
      userId: 'key-owner-1',
      routingUserId: 'key-owner-1',
      chatId: 'chat-1',
      workspaceId: 'workspace-1',
    })
  })

  it('rejects caller-controlled identity, model, and provider fields', async () => {
    for (const forbidden of [
      { userId: 'forged-user' },
      { model: 'caller-model' },
      { provider: 'caller-provider' },
      { chatId: 'raw-private-chat-id' },
      { conversationId: 'raw-private-chat-id' },
    ]) {
      const response = await callChat({
        workspaceId: 'workspace-1',
        prompt: 'hello',
        ...forbidden,
      })
      expect(response.status).toBe(400)
    }
    expect(mockResolveBillingAttribution).not.toHaveBeenCalled()
    expect(mockRunWorkspaceChat).not.toHaveBeenCalled()
  })

  it('returns the shared v2 auth error before parsing the body', async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      limit: 0,
      remaining: 0,
      resetAt: new Date(),
      error: 'Invalid API key',
    })

    const response = await callChat({})

    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('UNAUTHORIZED')
    expect(mockV2ApiGateError).not.toHaveBeenCalled()
  })

  it('stops local work, marks Go once, and retains the lease until the lifecycle settles', async () => {
    const teardownOrder: string[] = []
    let settle!: () => void
    let lifecycleSignal: AbortSignal | undefined
    let userStopSignal: AbortSignal | undefined
    mockRequestExplicitStreamAbort.mockImplementationOnce(async () => {
      teardownOrder.push('go-abort')
    })
    mockReleasePendingChatStream.mockImplementationOnce(async () => {
      teardownOrder.push('release')
    })
    mockRunWorkspaceChat.mockImplementationOnce(
      (input) =>
        new Promise((resolve) => {
          lifecycleSignal = input.abortSignal
          userStopSignal = input.userStopSignal
          input.onInitialStreamAccepted?.()
          settle = () =>
            resolve({
              success: false,
              cancelled: true,
              content: '',
              contentBlocks: [],
              toolCalls: [],
            })
        })
    )
    const request = new NextRequest('http://localhost:3000/api/v2/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'caller-platform-key',
      },
      body: JSON.stringify({ workspaceId: 'workspace-1', prompt: 'keep going' }),
    })

    const response = await POST(request)
    const reader = response.body!.getReader()
    await reader.read()
    await reader.cancel('test_disconnect')

    await vi.waitFor(() => expect(mockRequestExplicitStreamAbort).toHaveBeenCalledTimes(1))
    expect(mockRequestExplicitStreamAbort).toHaveBeenCalledWith({
      streamId: 'message-1',
      userId: 'key-owner-1',
      routingUserId: 'key-owner-1',
      chatId: 'chat-1',
      workspaceId: 'workspace-1',
    })
    expect(lifecycleSignal?.aborted).toBe(false)
    expect(userStopSignal?.aborted).toBe(true)
    expect(userStopSignal?.reason).toBe('user_stop:abortActiveStream')
    expect(mockReleasePendingChatStream).not.toHaveBeenCalled()

    settle()
    await vi.waitFor(() => expect(mockReleasePendingChatStream).toHaveBeenCalledTimes(1))
    expect(teardownOrder).toEqual(['go-abort', 'release'])
    expect(mockUnregisterActiveStream).toHaveBeenCalledTimes(1)
    expect(mockCleanupAbortMarker).toHaveBeenCalledWith('message-1')
  })

  it('does not start a lifecycle when Stop wins before workspace chat begins', async () => {
    mockRegisterActiveStream.mockImplementationOnce(
      (
        _streamId: string,
        _lifecycleController: AbortController,
        userStopController: AbortController
      ) => userStopController.abort('user_stop:abortActiveStream')
    )

    const response = await callChat({ workspaceId: 'workspace-1', prompt: 'keep going' })
    expect(await response.text()).toBe('')

    expect(mockRunWorkspaceChat).not.toHaveBeenCalled()
    expect(mockUnregisterActiveStream).toHaveBeenCalledWith('message-1')
    expect(mockReleasePendingChatStream).toHaveBeenCalledWith('chat-1', 'message-1')
    expect(mockCleanupAbortMarker).toHaveBeenCalledWith('message-1')
  })

  it('still stops local work and retains the lease when the Go abort marker fails', async () => {
    let settle!: () => void
    let lifecycleSignal: AbortSignal | undefined
    let userStopSignal: AbortSignal | undefined
    mockRequestExplicitStreamAbort.mockRejectedValueOnce(new Error('marker unavailable'))
    mockRunWorkspaceChat.mockImplementationOnce(
      (input) =>
        new Promise((resolve) => {
          lifecycleSignal = input.abortSignal
          userStopSignal = input.userStopSignal
          input.onInitialStreamAccepted?.()
          settle = () =>
            resolve({
              success: true,
              content: 'settled naturally',
              contentBlocks: [],
              toolCalls: [],
            })
        })
    )

    const request = new NextRequest('http://localhost:3000/api/v2/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'caller-platform-key',
      },
      body: JSON.stringify({ workspaceId: 'workspace-1', prompt: 'keep going' }),
    })
    const response = await POST(request)
    const reader = response.body!.getReader()
    await reader.read()
    await reader.cancel('test_disconnect')

    await vi.waitFor(() => expect(mockRequestExplicitStreamAbort).toHaveBeenCalledTimes(1))
    expect(lifecycleSignal?.aborted).toBe(false)
    expect(userStopSignal?.aborted).toBe(true)
    expect(userStopSignal?.reason).toBe('user_stop:abortActiveStream')
    expect(mockReleasePendingChatStream).not.toHaveBeenCalled()

    settle()
    await vi.waitFor(() => expect(mockReleasePendingChatStream).toHaveBeenCalledTimes(1))
  })
})
