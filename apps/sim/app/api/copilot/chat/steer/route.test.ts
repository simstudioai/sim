import { copilotMessages } from '@sim/db/schema'
import { createMockRequest } from '@sim/testing'
import { authMockFns } from '@sim/testing/mocks/auth.mock'
import { queueTableRows } from '@sim/testing/mocks/database.mock'
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
import { mothershipEnvironmentContextMock } from '@sim/testing/mocks/mothership-environment-context.mock'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import {
  workspaceAuthorizationMock,
  workspaceAuthorizationMockFns,
} from '@sim/testing/mocks/workspace-authorization.mock'
import {
  workspaceFileManagerMock,
  workspaceFileManagerMockFns,
} from '@sim/testing/mocks/workspace-file-manager.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/mothership/async-runs/repository', () => mothershipAsyncRunsMock)
vi.mock('@/lib/mothership/chat/messages-store', () => mothershipChatMessagesMock)
vi.mock('@/lib/mothership/server/agent-url', () => mothershipAgentUrlMock)

const { mockChatContext, mockProcessContexts } = vi.hoisted(() => ({
  mockChatContext: vi.fn(),
  mockProcessContexts: vi.fn(),
}))
vi.mock('@/lib/mothership/chat/process-contents', () => ({
  processContextsServer: mockProcessContexts,
}))
vi.mock('@/lib/mothership/environment-context', () => mothershipEnvironmentContextMock)
vi.mock('@/lib/uploads/contexts/workspace/file-manager', () => workspaceFileManagerMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/mothership/chat/application/context', () => ({
  resolveOwnedChatContext: mockChatContext,
}))
vi.mock('@/lib/core/application/workspace-authorization', () => workspaceAuthorizationMock)

import { POST } from '@/app/api/copilot/chat/steer/route'

const { mockAuthorizeWorkspaceOperation: mockAuthorize } = workspaceAuthorizationMockFns

const mockAuthenticate = authMockFns.mockGetSession
const mockGetLatestRunForStream = mothershipAsyncRunsMockFns.mockGetLatestRunForStream
const mockAppend = mothershipChatMessagesMockFns.mockAppendSteeringMessageIfAbsent
const mockRecordDisposition = mothershipChatMessagesMockFns.mockRecordSteeringDisposition

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
    mockAppend.mockResolvedValue(true)
    mockRecordDisposition.mockResolvedValue(undefined)
  })

  it('records the message with the exact input it sends before asking the worker', async () => {
    worker.v2.push(Response.json({ steeringId: STEERING_ID, status: 'queued' }))
    let callsWhenRecorded: string[] | undefined
    mockAppend.mockImplementationOnce(async () => {
      callsWhenRecorded = [...worker.calls]
      return true
    })

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
      expect.objectContaining({
        id: STEERING_ID,
        content: 'focus on the tests',
        steering: { streamId: STREAM_ID, input: { context: [] } },
      }),
      { streamId: STREAM_ID }
    )
    expect(callsWhenRecorded).toEqual([])
  })

  it('reports a message its run never applied, so the sender sends it on its own', async () => {
    worker.v2.push(Response.json({ steeringId: STEERING_ID, status: 'not_applied' }))

    const response = await POST(steerRequest())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ steeringId: STEERING_ID, status: 'not_applied' })
  })

  it('refuses to steer through a worker without v2, and never tries v1', async () => {
    worker.v2.push(new Response('404 page not found', { status: 404 }))
    const missingRoute = await POST(steerRequest())
    worker.v2.push(new Response(null, { status: 405 }))
    const wrongMethod = await POST(steerRequest())

    expect(missingRoute.status).toBe(409)
    expect(wrongMethod.status).toBe(409)
    expect(worker.calls).toEqual(['/api/streams/steer/v2', '/api/streams/steer/v2'])
  })

  it.each([
    ['a body that is no disposition', () => Response.json({ settled: true })],
    ['a body that is not JSON', () => new Response('ok')],
    [
      "another message's disposition",
      () => Response.json({ steeringId: STREAM_ID, status: 'queued' }),
    ],
  ])('refuses, never fails, on a success carrying %s', async (_name, reply) => {
    worker.v2.push(reply())

    const response = await POST(steerRequest())

    expect(response.status).toBe(409)
    expect(worker.calls).toEqual(['/api/streams/steer/v2'])
  })

  it('never steers a turn into itself, and asks the worker nothing', async () => {
    const response = await POST(
      createMockRequest('POST', {
        streamId: STEERING_ID,
        chatId: 'chat-1',
        steeringId: STEERING_ID,
        content: 'focus on the tests',
      })
    )

    expect(response.status).toBe(409)
    expect(mockAppend).not.toHaveBeenCalled()
    expect(worker.calls).toEqual([])
  })

  it('refuses an id that names a turn of its own, without asking the worker', async () => {
    mockAppend.mockResolvedValueOnce(false)

    const response = await POST(steerRequest())

    expect(response.status).toBe(409)
    expect(worker.calls).toEqual([])
  })

  it('reads a queued message as not applied once Sim recorded its run as over', async () => {
    worker.v2.push(Response.json({ steeringId: STEERING_ID, status: 'queued' }))
    mockGetLatestRunForStream.mockResolvedValue({
      chatId: 'chat-1',
      workspaceId: 'workspace-1',
      status: 'cancelled',
    })

    const response = await POST(steerRequest())

    expect(await response.json()).toEqual({ steeringId: STEERING_ID, status: 'not_applied' })
    expect(mockRecordDisposition).toHaveBeenCalledWith('chat-1', [STEERING_ID], {
      status: 'not_applied',
    })
  })

  it('keeps reading a queued message while its run runs, keeping its input', async () => {
    worker.v2.push(Response.json({ steeringId: STEERING_ID, status: 'queued' }))
    mockGetLatestRunForStream.mockResolvedValue({
      chatId: 'chat-1',
      workspaceId: 'workspace-1',
      status: 'active',
    })

    const response = await POST(steerRequest())

    expect(await response.json()).toEqual({ steeringId: STEERING_ID, status: 'queued' })
    expect(mockRecordDisposition).not.toHaveBeenCalled()
  })

  it('refuses a run the worker never learns of', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      for (let attempt = 0; attempt < 5; attempt++) worker.v2.push(targetMissing())

      const pending = POST(steerRequest())
      await vi.advanceTimersByTimeAsync(5_000)
      const response = await pending

      expect(response.status).toBe(409)
      expect(worker.calls).toEqual(Array(5).fill('/api/streams/steer/v2'))
    } finally {
      vi.useRealTimers()
    }
  })

  it('retries a run at its pending-input budget, then refuses it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const full = () => Response.json({ code: 'steering_capacity' }, { status: 429 })
      worker.v2.push(full(), full(), Response.json({ steeringId: STEERING_ID, status: 'queued' }))
      const eased = POST(steerRequest())
      await vi.advanceTimersByTimeAsync(5_000)
      expect(await (await eased).json()).toEqual({ steeringId: STEERING_ID, status: 'queued' })

      worker.calls = []
      for (let attempt = 0; attempt < 4; attempt++) worker.v2.push(full())
      const stillFull = POST(steerRequest())
      await vi.advanceTimersByTimeAsync(5_000)
      expect((await stillFull).status).toBe(409)
      expect(worker.calls).toHaveLength(4)
    } finally {
      vi.useRealTimers()
    }
  })

  it('refuses a message past the run image limit at once, without retrying the steer', async () => {
    worker.v2.push(Response.json({ code: 'steering_image_limit' }, { status: 422 }))

    const response = await POST(steerRequest())

    expect(response.status).toBe(409)
    expect(worker.calls).toEqual(['/api/streams/steer/v2'])
  })

  it('renders files and mentions as a turn does, and records that exact input', async () => {
    worker.v2.push(Response.json({ steeringId: STEERING_ID, status: 'queued' }))
    mockProcessContexts.mockResolvedValueOnce([{ type: 'workflow', content: 'mentioned' }])
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValueOnce('write')
    workspaceFileManagerMockFns.mockTrackChatUpload.mockResolvedValueOnce({
      displayName: 'notes.pdf',
    })

    const response = await POST(
      createMockRequest('POST', {
        streamId: STREAM_ID,
        chatId: 'chat-1',
        steeringId: STEERING_ID,
        content: 'use these',
        contexts: [{ kind: 'workflow', workflowId: 'wf-1', label: 'Invoices' }],
        fileAttachments: [
          {
            id: 'file-1',
            key: 'uploads/file-1',
            filename: 'notes.pdf',
            media_type: 'application/pdf',
            size: 10,
          },
        ],
      })
    )

    expect(response.status).toBe(200)
    const sent = worker.bodies[0] as { context: Array<{ type: string }> }
    expect(sent.context.map((item) => item.type)).toEqual(['workflow', 'uploaded_file'])
    const recorded = mockAppend.mock.calls[0][1] as { steering: { input: unknown } }
    expect(recorded.steering.input).toEqual({ context: sent.context })
  })

  it('re-sends the recorded input on a retry, even if its mentions would now render differently', async () => {
    const recordedInput = { context: [{ type: 'workflow', content: 'as first rendered' }] }
    queueTableRows(copilotMessages, [
      {
        content: {
          content: 'focus on the tests',
          steering: { streamId: STREAM_ID, input: recordedInput },
        },
      },
    ])
    worker.v2.push(Response.json({ steeringId: STEERING_ID, status: 'not_applied' }))

    const response = await POST(
      createMockRequest('POST', {
        streamId: STREAM_ID,
        chatId: 'chat-1',
        steeringId: STEERING_ID,
        content: 'focus on the tests',
        contexts: [{ kind: 'workflow', workflowId: 'wf-1', label: 'Invoices' }],
      })
    )

    expect(await response.json()).toEqual({ steeringId: STEERING_ID, status: 'not_applied' })
    expect(worker.bodies[0]).toMatchObject(recordedInput)
    expect(mockProcessContexts).not.toHaveBeenCalled()
    expect(mockAppend).not.toHaveBeenCalled()
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
