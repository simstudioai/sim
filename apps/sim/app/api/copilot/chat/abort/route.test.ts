import { createMockRequest } from '@sim/testing'
import { sleep } from '@sim/utils/helpers'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAbortActiveStream,
  mockAuthenticate,
  mockGetLatestRunForStream,
  mockReleasePendingChatStream,
  mockRequestExplicitStreamAbort,
  mockWaitForPendingChatStream,
  mockStreamToolsSettled,
  mockUnsettledProcesses,
  mockUnsettledWorkflows,
  mockCancelWorkflow,
  mockAbortWorkflow,
  mockStopProcess,
  mockSettleProcess,
  mockRequestRunStop,
  order,
} = vi.hoisted(() => {
  const order: string[] = []
  return {
    order,
    mockAbortActiveStream: vi.fn(async () => {
      order.push('abortActiveStream')
      return true
    }),
    mockRequestExplicitStreamAbort: vi.fn(async () => {
      order.push('requestExplicitStreamAbort')
      return { settled: true }
    }),
    mockAuthenticate: vi.fn(),
    mockGetLatestRunForStream: vi.fn(),
    mockWaitForPendingChatStream: vi.fn(),
    mockReleasePendingChatStream: vi.fn(),
    mockStreamToolsSettled: vi.fn(),
    mockUnsettledProcesses: vi.fn(),
    mockUnsettledWorkflows: vi.fn(),
    mockCancelWorkflow: vi.fn(),
    mockAbortWorkflow: vi.fn(),
    mockStopProcess: vi.fn(),
    mockSettleProcess: vi.fn(),
    mockRequestRunStop: vi.fn(),
  }
})

vi.mock('@/lib/auth', () => ({ getSession: mockAuthenticate }))
vi.mock('@/lib/mothership/async-runs/repository', () => ({
  getLatestRunForStream: mockGetLatestRunForStream,
  areStreamToolExecutionsSettled: mockStreamToolsSettled,
  getUnsettledStreamSandboxProcesses: mockUnsettledProcesses,
  getUnsettledClientWorkflowExecutions: mockUnsettledWorkflows,
  settleSimSandboxProcess: mockSettleProcess,
  requestRunStop: mockRequestRunStop,
}))
vi.mock('@/lib/execution/cancellation', () => ({ markExecutionCancelled: mockCancelWorkflow }))
vi.mock('@/lib/execution/manual-cancellation', () => ({ abortManualExecution: mockAbortWorkflow }))
vi.mock('@/lib/execution/remote-sandbox/e2b', () => ({ stopE2BSessionProcess: mockStopProcess }))
vi.mock('@/lib/mothership/request/session', () => ({
  abortActiveStream: mockAbortActiveStream,
  waitForPendingChatStream: mockWaitForPendingChatStream,
  releasePendingChatStream: mockReleasePendingChatStream,
}))
vi.mock('@/lib/mothership/request/session/explicit-abort', () => ({
  requestExplicitStreamAbort: mockRequestExplicitStreamAbort,
}))

const {
  mockChatContext,
  mockAuthorize,
  mockOrganizationAuthorize,
  mockWorkspaceContext,
  mockBannedUsers,
} = vi.hoisted(() => ({
  mockChatContext: vi.fn(),
  mockAuthorize: vi.fn(),
  mockOrganizationAuthorize: vi.fn(),
  mockWorkspaceContext: vi.fn(),
  mockBannedUsers: vi.fn(),
}))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  resolveActiveWorkspaceApplicationContext: mockWorkspaceContext,
}))
vi.mock('@/lib/auth/ban', () => ({ getActivelyBannedUserIds: mockBannedUsers }))
vi.mock('@/lib/mothership/chat/application/context', () => ({
  resolveOwnedChatContext: mockChatContext,
}))
vi.mock('@/lib/core/application/workspace-authorization', async (original) => ({
  ...(await original<typeof import('@/lib/core/application/workspace-authorization')>()),
  authorizeWorkspaceOperation: mockAuthorize,
}))
vi.mock('@/lib/core/application/organization-authorization', () => ({
  authorizeOrganizationOperation: mockOrganizationAuthorize,
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { POST } from '@/app/api/copilot/chat/abort/route'

function abortRequest() {
  return createMockRequest('POST', { streamId: 'stream-1', chatId: 'chat-1' })
}

describe('POST /api/copilot/chat/abort', () => {
  beforeEach(() => {
    mockChatContext.mockResolvedValue({
      chatId: 'chat-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: false,
    })
    mockAuthorize.mockResolvedValue(undefined)
    mockOrganizationAuthorize.mockResolvedValue(undefined)
    mockBannedUsers.mockResolvedValue([])
    mockWorkspaceContext.mockResolvedValue({
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: false,
    })
    mockRequestRunStop.mockResolvedValue({ chatId: 'chat-1', workspaceId: 'workspace-1' })
    order.length = 0
    mockAuthenticate.mockResolvedValue({ user: { id: 'user-1' }, session: { id: 'session-1' } })
    mockGetLatestRunForStream.mockResolvedValue({ chatId: 'chat-1', workspaceId: 'workspace-1' })
    mockWaitForPendingChatStream.mockResolvedValue(true)
    mockStreamToolsSettled.mockResolvedValue(true)
    mockUnsettledProcesses.mockResolvedValue([])
    mockUnsettledWorkflows.mockResolvedValue([])
    mockCancelWorkflow.mockResolvedValue({ durablyRecorded: true, reason: 'recorded' })
    mockAbortWorkflow.mockReturnValue(false)
    mockStopProcess.mockResolvedValue(undefined)
    mockSettleProcess.mockResolvedValue(undefined)
  })

  it('cancels only the admitted client execution and still requires its settlement receipt', async () => {
    mockUnsettledWorkflows.mockResolvedValue(['client-execution'])
    mockStreamToolsSettled.mockResolvedValue(false)
    const response = await POST(abortRequest())
    expect(await response.json()).toMatchObject({ settled: false })
    expect(mockUnsettledWorkflows).toHaveBeenCalledExactlyOnceWith('stream-1', 'user-1')
    expect(mockCancelWorkflow).toHaveBeenCalledExactlyOnceWith('client-execution')
    expect(mockAbortWorkflow).toHaveBeenCalledExactlyOnceWith('client-execution')
  })

  it('does not signal workflows when the atomic Stop and admission closure cannot commit', async () => {
    mockRequestRunStop.mockRejectedValueOnce(new Error('database unavailable'))
    const response = await POST(abortRequest())
    expect(response.status).toBe(500)
    expect(mockRequestExplicitStreamAbort).not.toHaveBeenCalled()
    expect(mockUnsettledWorkflows).not.toHaveBeenCalled()
    expect(mockCancelWorkflow).not.toHaveBeenCalled()
  })

  it('recovers recorded commands before certifying settlement after a disconnected executor', async () => {
    const process = {
      id: 'command-1',
      sandboxId: 'sandbox-1',
      sessionKey: 'chat:1',
      toolCallId: 'tool-1',
    }
    mockUnsettledProcesses.mockResolvedValue([process])
    mockStreamToolsSettled.mockImplementation(async () => mockSettleProcess.mock.calls.length === 1)
    const response = await POST(abortRequest())
    expect(await response.json()).toMatchObject({ settled: true })
    expect(mockStopProcess).toHaveBeenCalledExactlyOnceWith(process, expect.any(AbortSignal))
    expect(mockSettleProcess).toHaveBeenCalledExactlyOnceWith('tool-1', 'command-1')
  })

  it('records Stop before a new chat has a reservation or run without signalling an unknown worker', async () => {
    mockGetLatestRunForStream.mockResolvedValue(null)
    mockRequestRunStop.mockResolvedValue(null)
    const response = await POST(
      createMockRequest('POST', { streamId: 'stream-1', workspaceId: 'workspace-1' })
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ aborted: true, settled: true })
    expect(mockRequestExplicitStreamAbort).not.toHaveBeenCalled()
    expect(mockAbortActiveStream).not.toHaveBeenCalled()
    expect(mockRequestRunStop).toHaveBeenCalledExactlyOnceWith({
      streamId: 'stream-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
    })
    expect(mockAuthorize).toHaveBeenCalled()
  })

  it('bounds recovery and waits for stream shutdown concurrently', async () => {
    vi.useFakeTimers()
    try {
      mockUnsettledProcesses.mockResolvedValue([
        { id: 'pending', sandboxId: 'sandbox-1', sessionKey: 'chat:1', toolCallId: 'tool-1' },
      ])
      let entered!: () => void
      const waiting = new Promise<void>((resolve) => {
        entered = resolve
      })
      mockStopProcess.mockImplementationOnce(
        (_process, signal: AbortSignal) =>
          new Promise<void>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true })
            entered()
          })
      )
      // Node's AbortSignal timeout is independent of fake timers; drive the provided signal explicitly.
      const controller = new AbortController()
      const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
      mockWaitForPendingChatStream.mockImplementationOnce(async () => {
        await sleep(8000)
        return false
      })
      const response = POST(abortRequest())
      await waiting
      expect(mockWaitForPendingChatStream).toHaveBeenCalledOnce()
      expect(timeout).toHaveBeenCalledWith(8000)
      controller.abort(new Error('recovery budget expired'))
      await vi.advanceTimersByTimeAsync(8000)
      expect(await (await response).json()).toMatchObject({ settled: false })
      expect(mockSettleProcess).not.toHaveBeenCalled()
      timeout.mockRestore()
    } finally {
      vi.useRealTimers()
    }
  })

  it('retains failed command recovery and still stops independent commands', async () => {
    mockUnsettledProcesses.mockResolvedValue([
      { id: 'unknown', sandboxId: 'sandbox-1', sessionKey: 'chat:1', toolCallId: 'tool-1' },
      { id: 'known', sandboxId: 'sandbox-1', sessionKey: 'chat:1', toolCallId: 'tool-2' },
    ])
    mockStopProcess.mockRejectedValueOnce(new Error('provider unavailable'))
    mockStreamToolsSettled.mockResolvedValue(false)
    const response = await POST(abortRequest())
    expect(await response.json()).toMatchObject({ settled: false })
    expect(mockStopProcess).toHaveBeenCalledTimes(2)
    expect(mockSettleProcess).toHaveBeenCalledExactlyOnceWith('tool-2', 'known')
  })

  it('force-releases the chat stream lock when the stream never settles', async () => {
    mockWaitForPendingChatStream.mockResolvedValue(false)

    const response = await POST(abortRequest())

    await expect(response.json()).resolves.toMatchObject({ settled: false, forceReleased: true })
    expect(mockReleasePendingChatStream).toHaveBeenCalledWith('chat-1', 'stream-1')
  })

  it('refuses mixed owner scopes in the HTTP contract before protected lookup', async () => {
    const response = await POST(
      createMockRequest('POST', {
        streamId: 'early-stream',
        organizationId: 'org-1',
        workspaceId: 'workspace-1',
      })
    )
    expect(response.status).toBe(400)
    expect(mockGetLatestRunForStream).not.toHaveBeenCalled()
    expect(mockRequestRunStop).not.toHaveBeenCalled()
  })

  it('rechecks organization membership before writing a pre-admission Stop', async () => {
    mockGetLatestRunForStream.mockResolvedValue(null)
    mockOrganizationAuthorize.mockRejectedValueOnce(
      new OrchestrationError('forbidden', 'Membership revoked')
    )
    const response = await POST(
      createMockRequest('POST', { streamId: 'early-stream', organizationId: 'org-1' })
    )
    expect(response.status).toBe(403)
    expect(mockRequestRunStop).not.toHaveBeenCalled()
  })

  it('binds an organization admission that wins the Stop race before signalling it', async () => {
    mockGetLatestRunForStream.mockResolvedValue(null)
    mockChatContext.mockResolvedValue({
      chatId: 'new-chat',
      userId: 'user-1',
      organizationId: 'org-1',
    })
    mockRequestRunStop.mockResolvedValue({
      chatId: 'new-chat',
      workspaceId: null,
      organizationId: 'org-1',
    })
    const response = await POST(
      createMockRequest('POST', { streamId: 'early-stream', organizationId: 'org-1' })
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ settled: true })
    expect(mockRequestExplicitStreamAbort).toHaveBeenCalledWith(
      expect.objectContaining({
        streamId: 'early-stream',
        chatId: 'new-chat',
      })
    )
  })

  it('refuses an inaccessible organization chat before changing stream state', async () => {
    mockChatContext.mockRejectedValueOnce(new OrchestrationError('not_found', 'Chat not found'))
    const response = await POST(abortRequest())
    expect(response.status).toBe(404)
    expect(mockRequestExplicitStreamAbort).not.toHaveBeenCalled()
    expect(mockAbortActiveStream).not.toHaveBeenCalled()
  })

  it('refuses a chat ID that does not belong to the authenticated run', async () => {
    mockGetLatestRunForStream.mockResolvedValueOnce({ chatId: 'different-chat' })
    const response = await POST(abortRequest())
    expect(response.status).toBe(403)
    expect(mockAbortActiveStream).not.toHaveBeenCalled()
  })

  it('does not claim settlement while a tool outlives its closed stream', async () => {
    mockStreamToolsSettled.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const stopped = await POST(abortRequest())
    await expect(stopped.json()).resolves.toMatchObject({ settled: false })
    expect(mockStreamToolsSettled).toHaveBeenCalledWith('stream-1', 'user-1')
    const finished = await POST(abortRequest())
    await expect(finished.json()).resolves.toMatchObject({ settled: true })
  })

  it('does not turn a forced lock release into worker settlement on a repeated Stop', async () => {
    mockWaitForPendingChatStream.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    mockRequestExplicitStreamAbort
      .mockResolvedValueOnce({ settled: false })
      .mockResolvedValueOnce({ settled: false })
    const first = await POST(abortRequest())
    await expect(first.json()).resolves.toMatchObject({ settled: false, forceReleased: true })
    const second = await POST(abortRequest())
    await expect(second.json()).resolves.toMatchObject({ settled: false })
    expect(mockReleasePendingChatStream).toHaveBeenCalledTimes(1)
  })

  it('rejects an asserted chat mismatch', async () => {
    mockGetLatestRunForStream.mockResolvedValue({
      chatId: 'other-chat',
      workspaceId: 'workspace-1',
    })
    expect((await POST(abortRequest())).status).toBe(403)
    expect(mockRequestExplicitStreamAbort).not.toHaveBeenCalled()
    expect(mockReleasePendingChatStream).not.toHaveBeenCalled()
  })

  it('rechecks current workspace permission before controlling the run', async () => {
    mockAuthorize.mockRejectedValue(new Error('access revoked'))
    expect((await POST(abortRequest())).status).toBe(500)
    expect(mockRequestExplicitStreamAbort).not.toHaveBeenCalled()
  })
  it('rejects a run admitted in a different scope during the lookup race', async () => {
    mockGetLatestRunForStream.mockResolvedValue(null)
    mockRequestRunStop.mockResolvedValue({ chatId: 'chat-2', workspaceId: 'workspace-2' })
    mockChatContext.mockResolvedValue({
      chatId: 'chat-2',
      userId: 'user-1',
      workspaceId: 'workspace-2',
    })
    expect(
      (await POST(createMockRequest('POST', { streamId: 'stream-1', workspaceId: 'workspace-1' })))
        .status
    ).toBe(403)
    expect(mockRequestExplicitStreamAbort).not.toHaveBeenCalled()
  })
  it('does not acknowledge pending Stop when its durable write fails', async () => {
    mockGetLatestRunForStream.mockResolvedValue(null)
    mockRequestRunStop.mockRejectedValueOnce(new Error('database unavailable'))
    expect((await POST(abortRequest())).status).toBe(500)
    expect(mockRequestExplicitStreamAbort).not.toHaveBeenCalled()
    expect(mockAbortActiveStream).not.toHaveBeenCalled()
  })
  it.each(['revoked', 'banned'])('does not record a pending Stop for a %s user', async (reason) => {
    mockGetLatestRunForStream.mockResolvedValue(null)
    if (reason === 'banned') mockBannedUsers.mockResolvedValue(['user-1'])
    else mockAuthorize.mockRejectedValueOnce(new Error('access revoked'))
    const response = await POST(
      createMockRequest('POST', { streamId: 'stream-1', workspaceId: 'workspace-1' })
    )
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(mockRequestRunStop).not.toHaveBeenCalled()
    expect(mockRequestExplicitStreamAbort).not.toHaveBeenCalled()
  })
})
