/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAuthenticate, mockGetLatestRunForStream, mockRequestStreamSteering, mockAppend } =
  vi.hoisted(() => ({
    mockAuthenticate: vi.fn(),
    mockGetLatestRunForStream: vi.fn(),
    mockRequestStreamSteering: vi.fn(),
    mockAppend: vi.fn(),
  }))

vi.mock('@/lib/auth', () => ({ getSession: mockAuthenticate }))
vi.mock('@/lib/mothership/async-runs/repository', () => ({
  getLatestRunForStream: mockGetLatestRunForStream,
}))
vi.mock('@/lib/mothership/request/session/steer', () => ({
  requestStreamSteering: mockRequestStreamSteering,
}))
vi.mock('@/lib/mothership/chat/messages-store', () => ({
  appendCopilotChatMessages: mockAppend,
}))

const { mockChatContext, mockAuthorize } = vi.hoisted(() => ({
  mockChatContext: vi.fn(),
  mockAuthorize: vi.fn(),
}))
vi.mock('@/lib/mothership/chat/application/context', () => ({
  resolveOwnedChatContext: mockChatContext,
}))
vi.mock('@/lib/core/application/workspace-authorization', async (original) => ({
  ...(await original<typeof import('@/lib/core/application/workspace-authorization')>()),
  authorizeWorkspaceOperation: mockAuthorize,
}))

import { POST } from '@/app/api/copilot/chat/steer/route'

function steerRequest(overrides: Record<string, unknown> = {}) {
  return createMockRequest('POST', {
    streamId: 'stream-1',
    chatId: 'chat-1',
    steeringId: 'steer-1',
    content: 'focus on the tests',
    ...overrides,
  })
}

describe('POST /api/copilot/chat/steer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockChatContext.mockResolvedValue({
      chatId: 'chat-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: false,
    })
    mockAuthorize.mockResolvedValue(undefined)
    mockAuthenticate.mockResolvedValue({ user: { id: 'user-1' }, session: { id: 'session-1' } })
    mockGetLatestRunForStream.mockResolvedValue({ chatId: 'chat-1', workspaceId: 'workspace-1' })
    mockRequestStreamSteering.mockResolvedValue({ queued: true, status: 200 })
    mockAppend.mockResolvedValue(undefined)
  })

  it('queues steering with Go and persists the user message', async () => {
    const response = await POST(steerRequest())

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, queued: true })
    expect(mockRequestStreamSteering).toHaveBeenCalledWith(
      expect.objectContaining({
        streamId: 'stream-1',
        chatId: 'chat-1',
        steeringId: 'steer-1',
        content: 'focus on the tests',
        userId: 'user-1',
      })
    )
    expect(mockAppend).toHaveBeenCalledWith(
      'chat-1',
      [
        expect.objectContaining({
          id: 'steer-1',
          role: 'user',
          content: 'focus on the tests',
        }),
      ],
      { streamId: 'stream-1' }
    )
  })

  it('returns 409 when Go rejects the steer so the client falls back to a normal send', async () => {
    mockRequestStreamSteering.mockResolvedValue({ queued: false, status: 429 })

    const response = await POST(steerRequest())

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ ok: false, queued: false })
    expect(mockAppend).not.toHaveBeenCalled()
  })

  it('returns 409 when the Go forward throws', async () => {
    mockRequestStreamSteering.mockRejectedValue(new Error('network down'))

    const response = await POST(steerRequest())

    expect(response.status).toBe(409)
    expect(mockAppend).not.toHaveBeenCalled()
  })

  it('rejects a chat that does not own the stream', async () => {
    mockGetLatestRunForStream.mockResolvedValue({ chatId: 'other-chat' })

    const response = await POST(steerRequest())

    expect(response.status).toBe(403)
    expect(mockRequestStreamSteering).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated callers', async () => {
    mockAuthenticate.mockResolvedValue(null)

    const response = await POST(steerRequest())

    expect(response.status).toBe(401)
    expect(mockRequestStreamSteering).not.toHaveBeenCalled()
  })

  it('rejects an empty content body', async () => {
    const response = await POST(steerRequest({ content: '' }))

    expect(response.status).toBe(400)
    expect(mockRequestStreamSteering).not.toHaveBeenCalled()
  })

  it('still reports queued when history persistence fails', async () => {
    mockAppend.mockRejectedValue(new Error('db down'))

    const response = await POST(steerRequest())

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, queued: true })
  })
  it('refuses a stream with no owned run', async () => {
    mockGetLatestRunForStream.mockResolvedValue(null)
    expect((await POST(steerRequest())).status).toBe(404)
    expect(mockRequestStreamSteering).not.toHaveBeenCalled()
  })
  it('does not forward when ownership lookup fails', async () => {
    mockGetLatestRunForStream.mockRejectedValue(new Error('db unavailable'))
    expect((await POST(steerRequest())).status).toBe(500)
    expect(mockRequestStreamSteering).not.toHaveBeenCalled()
  })

  it('rechecks current workspace permission before controlling the run', async () => {
    mockAuthorize.mockRejectedValue(new Error('access revoked'))
    expect((await POST(steerRequest())).status).toBe(500)
    expect(mockRequestStreamSteering).not.toHaveBeenCalled()
  })
})
