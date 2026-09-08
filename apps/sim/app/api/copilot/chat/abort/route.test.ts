/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetAccessibleChat,
  mockAbortActiveStream,
  mockAuthenticate,
  mockGetLatestRunForStream,
  mockReleasePendingChatStream,
  mockRequestExplicitStreamAbort,
  mockWaitForPendingChatStream,
  order,
} = vi.hoisted(() => {
  const order: string[] = []
  return {
    order,
    mockGetAccessibleChat: vi.fn(),
    mockAbortActiveStream: vi.fn(async () => {
      order.push('abortActiveStream')
      return true
    }),
    mockRequestExplicitStreamAbort: vi.fn(async () => {
      order.push('requestExplicitStreamAbort')
    }),
    mockAuthenticate: vi.fn(),
    mockGetLatestRunForStream: vi.fn(),
    mockWaitForPendingChatStream: vi.fn(),
    mockReleasePendingChatStream: vi.fn(),
  }
})

vi.mock('@/lib/copilot/chat/lifecycle', () => ({
  getAccessibleCopilotChatAuth: mockGetAccessibleChat,
}))

vi.mock('@/lib/copilot/request/http', () => ({
  authenticateCopilotRequestSessionOnly: mockAuthenticate,
}))
vi.mock('@/lib/copilot/async-runs/repository', () => ({
  getLatestRunForStream: mockGetLatestRunForStream,
}))
vi.mock('@/lib/copilot/request/session', () => ({
  abortActiveStream: mockAbortActiveStream,
  waitForPendingChatStream: mockWaitForPendingChatStream,
  releasePendingChatStream: mockReleasePendingChatStream,
}))
vi.mock('@/lib/copilot/request/session/explicit-abort', () => ({
  requestExplicitStreamAbort: mockRequestExplicitStreamAbort,
}))

import { POST } from '@/app/api/copilot/chat/abort/route'

function abortRequest() {
  return createMockRequest('POST', { streamId: 'stream-1', chatId: 'chat-1' })
}

describe('POST /api/copilot/chat/abort', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    order.length = 0
    mockGetAccessibleChat.mockResolvedValue({ id: 'chat-1' })
    mockAuthenticate.mockResolvedValue({ userId: 'user-1', isAuthenticated: true })
    mockGetLatestRunForStream.mockResolvedValue({ chatId: 'chat-1', workspaceId: 'workspace-1' })
    mockWaitForPendingChatStream.mockResolvedValue(true)
  })

  /**
   * The ordering invariant, not an implementation detail: `abortActiveStream`
   * is what drops the SSE, and Go decides "user stop vs. client disconnect"
   * the instant it sees that drop by consuming a marker exactly once. Marking
   * Go second lost that race on ~84% of stops and persisted deliberate stops
   * as unexpected terminations carrying a synthetic `provider_error`.
   */
  it('writes the Go abort marker before tearing down the local stream', async () => {
    const response = await POST(abortRequest())

    expect(response.status).toBe(200)
    expect(order).toEqual(['requestExplicitStreamAbort', 'abortActiveStream'])
  })

  it('still aborts locally when the Go marker write fails', async () => {
    mockRequestExplicitStreamAbort.mockRejectedValueOnce(new Error('go unreachable'))

    const response = await POST(abortRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ aborted: true, settled: true })
    expect(mockAbortActiveStream).toHaveBeenCalledWith('stream-1')
  })

  it('force-releases the chat stream lock when the stream never settles', async () => {
    mockWaitForPendingChatStream.mockResolvedValue(false)

    const response = await POST(abortRequest())

    await expect(response.json()).resolves.toMatchObject({ settled: false, forceReleased: true })
    expect(mockReleasePendingChatStream).toHaveBeenCalledWith('chat-1', 'stream-1')
  })

  it('refuses an inaccessible organization chat before changing stream state', async () => {
    mockGetAccessibleChat.mockResolvedValueOnce(null)
    const response = await POST(abortRequest())
    expect(response.status).toBe(404)
    expect(mockRequestExplicitStreamAbort).not.toHaveBeenCalled()
    expect(mockAbortActiveStream).not.toHaveBeenCalled()
  })

  it('refuses a chat ID that does not belong to the authenticated run', async () => {
    mockGetLatestRunForStream.mockResolvedValueOnce({ chatId: 'different-chat' })
    const response = await POST(abortRequest())
    expect(response.status).toBe(404)
    expect(mockAbortActiveStream).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated caller without touching either abort path', async () => {
    mockAuthenticate.mockResolvedValue({ userId: undefined, isAuthenticated: false })

    const response = await POST(abortRequest())

    expect(response.status).toBe(401)
    expect(mockRequestExplicitStreamAbort).not.toHaveBeenCalled()
    expect(mockAbortActiveStream).not.toHaveBeenCalled()
  })
})
