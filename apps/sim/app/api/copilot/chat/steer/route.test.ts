import { createMockRequest } from '@sim/testing'
import { authMockFns } from '@sim/testing/mocks/auth.mock'
import {
  mothershipAgentUrlMock,
  mothershipAgentUrlMockFns,
} from '@sim/testing/mocks/mothership-agent-url.mock'
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

vi.mock('@/lib/mothership/async-runs/repository', () => mothershipAsyncRunsMock)
vi.mock('@/lib/mothership/chat/messages-store', () => mothershipChatMessagesMock)
vi.mock('@/lib/mothership/server/agent-url', () => mothershipAgentUrlMock)

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

const WORKER = 'https://worker.test'
const STREAM_ID = '7f3c2b6e-1d4a-4c8b-9e2f-3a5b6c7d8e9f'
const STEERING_ID = '0b1c2d3e-4f50-4617-8899-aabbccddeeff'

/** The worker's scripted answers per route, in call order, and what it was sent. */
const worker: { v2: Response[]; v1: Response[]; calls: string[]; bodies: unknown[] } = {
  v2: [],
  v1: [],
  calls: [],
  bodies: [],
}

function steerRequest() {
  return createMockRequest('POST', {
    streamId: STREAM_ID,
    chatId: 'chat-1',
    steeringId: STEERING_ID,
    content: 'focus on the tests',
  })
}

function answer(route: 'v1' | 'v2'): Response {
  const next = worker[route].shift()
  if (!next) throw new Error(`No scripted worker answer for ${route}`)
  return next
}

const targetMissing = () => Response.json({ code: 'steering_target_missing' }, { status: 404 })

describe('POST /api/copilot/chat/steer', () => {
  beforeEach(() => {
    worker.v2 = []
    worker.v1 = []
    worker.calls = []
    worker.bodies = []
    mothershipAgentUrlMockFns.mockGetMothershipBaseURL.mockResolvedValue(WORKER)
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      worker.calls.push(url.replace(WORKER, ''))
      worker.bodies.push(JSON.parse(String(init?.body)))
      if (url === `${WORKER}/api/streams/steer/v2`) return answer('v2')
      if (url === `${WORKER}/api/streams/steer`) return answer('v1')
      throw new Error(`Unexpected worker call ${url}`)
    })
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
    mockAppend.mockResolvedValue(undefined)
  })

  it('returns the worker disposition and records a queued message as steering of its turn', async () => {
    worker.v2.push(Response.json({ steeringId: STEERING_ID, status: 'queued' }))

    const response = await POST(steerRequest())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ steeringId: STEERING_ID, status: 'queued' })
    expect(worker.bodies[0]).toEqual({
      messageId: STREAM_ID,
      steeringId: STEERING_ID,
      content: 'focus on the tests',
    })
    expect(mockAppend).toHaveBeenCalledWith(
      'chat-1',
      [expect.objectContaining({ id: STEERING_ID, steering: { streamId: STREAM_ID } })],
      { streamId: STREAM_ID }
    )
  })

  it('passes on where an applied message landed', async () => {
    worker.v2.push(
      Response.json({ steeringId: STEERING_ID, status: 'applied', eventSeq: 4, textOffset: 12 })
    )

    const response = await POST(steerRequest())

    expect(await response.json()).toEqual({
      steeringId: STEERING_ID,
      status: 'applied',
      eventSeq: 4,
      textOffset: 12,
    })
  })

  it('records nothing for a message its run never applied, so the sender sends it on its own', async () => {
    worker.v2.push(Response.json({ steeringId: STEERING_ID, status: 'not_applied' }))

    const response = await POST(steerRequest())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ steeringId: STEERING_ID, status: 'not_applied' })
    expect(mockAppend).not.toHaveBeenCalled()
  })

  it('falls back to v1 while the worker has no v2 route, and refuses what v1 refused', async () => {
    worker.v2.push(new Response('404 page not found', { status: 404 }))
    worker.v1.push(new Response(null, { status: 200 }))
    const queued = await POST(steerRequest())
    expect(await queued.json()).toEqual({ steeringId: STEERING_ID, status: 'queued' })

    worker.v2.push(new Response(null, { status: 405 }))
    worker.v1.push(new Response(null, { status: 404 }))
    const refused = await POST(steerRequest())
    expect(refused.status).toBe(409)
    expect(worker.calls).toEqual([
      '/api/streams/steer/v2',
      '/api/streams/steer',
      '/api/streams/steer/v2',
      '/api/streams/steer',
    ])
  })

  it('retries a run the worker has not inserted yet, then answers for it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      worker.v2.push(
        targetMissing(),
        targetMissing(),
        Response.json({ steeringId: STEERING_ID, status: 'queued' })
      )

      const pending = POST(steerRequest())
      await vi.advanceTimersByTimeAsync(2_000)
      const response = await pending

      expect(await response.json()).toEqual({ steeringId: STEERING_ID, status: 'queued' })
      expect(worker.calls).toEqual(Array(3).fill('/api/streams/steer/v2'))
    } finally {
      vi.useRealTimers()
    }
  })

  it('refuses a run the worker never learns of, without trying v1', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      for (let attempt = 0; attempt < 5; attempt++) worker.v2.push(targetMissing())

      const pending = POST(steerRequest())
      await vi.advanceTimersByTimeAsync(5_000)
      const response = await pending

      expect(response.status).toBe(409)
      expect(worker.calls).not.toContain('/api/streams/steer')
      expect(mockAppend).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('refuses a message the run has no room for', async () => {
    worker.v2.push(Response.json({ code: 'steering_capacity' }, { status: 429 }))

    const response = await POST(steerRequest())

    expect(response.status).toBe(409)
    expect(mockAppend).not.toHaveBeenCalled()
  })

  it('does not read a worker failure as a refusal, since the worker may hold the message', async () => {
    worker.v2.push(new Response('upstream failed', { status: 502 }))

    const response = await POST(steerRequest())

    expect(response.status).toBe(500)
    expect(worker.calls).toEqual(['/api/streams/steer/v2'])
  })

  it('rejects a chat that does not own the stream', async () => {
    mockGetLatestRunForStream.mockResolvedValue({ chatId: 'other-chat' })

    const response = await POST(steerRequest())

    expect(response.status).toBe(403)
    expect(worker.calls).toHaveLength(0)
  })

  it('refuses a stream with no owned run', async () => {
    mockGetLatestRunForStream.mockResolvedValue(null)
    expect((await POST(steerRequest())).status).toBe(404)
    expect(worker.calls).toHaveLength(0)
  })

  it('rechecks current workspace permission before controlling the run', async () => {
    mockAuthorize.mockRejectedValue(new Error('access revoked'))
    expect((await POST(steerRequest())).status).toBe(500)
    expect(worker.calls).toHaveLength(0)
  })
})
