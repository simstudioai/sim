import { createMockRequest } from '@sim/testing'
import { authMockFns } from '@sim/testing/mocks/auth.mock'
import {
  mothershipAsyncRunsMock,
  mothershipAsyncRunsMockFns,
} from '@sim/testing/mocks/mothership-async-runs.mock'
import {
  mothershipChatMessagesMock,
  mothershipChatMessagesMockFns,
} from '@sim/testing/mocks/mothership-chat-messages.mock'
import {
  workspaceAuthorizationMock,
  workspaceAuthorizationMockFns,
} from '@sim/testing/mocks/workspace-authorization.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequestStreamSteering } = vi.hoisted(() => ({
  mockRequestStreamSteering: vi.fn(),
}))

vi.mock('@/lib/mothership/async-runs/repository', () => mothershipAsyncRunsMock)
vi.mock('@/lib/mothership/request/session/steer', () => ({
  requestStreamSteering: mockRequestStreamSteering,
}))
vi.mock('@/lib/mothership/chat/messages-store', () => mothershipChatMessagesMock)

const { mockChatContext } = vi.hoisted(() => ({
  mockChatContext: vi.fn(),
}))
vi.mock('@/lib/mothership/chat/application/context', () => ({
  resolveOwnedChatContext: mockChatContext,
}))
vi.mock('@/lib/core/application/workspace-authorization', () => workspaceAuthorizationMock)

import { POST } from '@/app/api/copilot/chat/steer/route'

const { mockAuthorizeWorkspaceOperation: mockAuthorize } = workspaceAuthorizationMockFns

const mockAuthenticate = authMockFns.mockGetSession
const mockGetLatestRunForStream = mothershipAsyncRunsMockFns.mockGetLatestRunForStream
const mockAppend = mothershipChatMessagesMockFns.mockAppendCopilotChatMessages

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

  it('returns 409 when Go rejects the steer so the client falls back to a normal send', async () => {
    mockRequestStreamSteering.mockResolvedValue({ queued: false, status: 429 })

    const response = await POST(steerRequest())

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ ok: false, queued: false })
    expect(mockAppend).not.toHaveBeenCalled()
  })

  it('rejects a chat that does not own the stream', async () => {
    mockGetLatestRunForStream.mockResolvedValue({ chatId: 'other-chat' })

    const response = await POST(steerRequest())

    expect(response.status).toBe(403)
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

  it('rechecks current workspace permission before controlling the run', async () => {
    mockAuthorize.mockRejectedValue(new Error('access revoked'))
    expect((await POST(steerRequest())).status).toBe(500)
    expect(mockRequestStreamSteering).not.toHaveBeenCalled()
  })
})
