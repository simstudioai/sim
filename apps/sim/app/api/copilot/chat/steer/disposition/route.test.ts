/**
 * Failure modes: a read of what became of a steering message sends it, so a read
 * (a Retry, a turn's end) or a Dismiss delivers a message into a run; a message no
 * run holds reads as held and waits forever; a worker that predates the read, or a
 * stand-in answering any path, fails the read or is asked by re-sending.
 */
import { copilotMessages } from '@sim/db/schema'
import { createMockRequest } from '@sim/testing'
import { authMockFns } from '@sim/testing/mocks/auth.mock'
import { dbChainMockFns, queueTableRows } from '@sim/testing/mocks/database.mock'
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
const { mockChatContext } = vi.hoisted(() => ({ mockChatContext: vi.fn() }))
vi.mock('@/lib/mothership/chat/application/context', () => ({
  resolveOwnedChatContext: mockChatContext,
}))
vi.mock('@/lib/core/application/workspace-authorization', () => workspaceAuthorizationMock)

import { POST as DISMISS_ROUTE } from '@/app/api/copilot/chat/steer/dismiss/route'
import { POST as READ_ROUTE } from '@/app/api/copilot/chat/steer/disposition/route'

const WORKER = 'https://worker.test'
const READ = '/api/streams/steer/v2/disposition'
const TURN_ID = '7f3c2b6e-1d4a-4c8b-9e2f-3a5b6c7d8e9f'
const STEERING_ID = '0b1c2d3e-4f50-4617-8899-aabbccddeeff'
const mockGetLatestRunForStream = mothershipAsyncRunsMockFns.mockGetLatestRunForStream
const mockRecordDisposition = mothershipChatMessagesMockFns.mockRecordSteeringDisposition

/** The worker's scripted answers in call order, and every path it was called on. */
const worker: { answers: Response[]; calls: string[] } = { answers: [], calls: [] }

const body = () => ({ chatId: 'chat-1', steeringId: STEERING_ID })
const read = () => READ_ROUTE(createMockRequest('POST', body()))
const dismiss = () => DISMISS_ROUTE(createMockRequest('POST', body()))
const runIs = (status: 'active' | 'complete') =>
  mockGetLatestRunForStream.mockResolvedValue({ chatId: 'chat-1', status })
const withoutRead = () => new Response('404 page not found', { status: 404 })
/** The steering record the chat holds for the message, read once per request. */
const recorded = (steering: Record<string, unknown> = { streamId: TURN_ID }) =>
  queueTableRows(copilotMessages, [{ content: { content: 'Then summarize', steering } }])

describe('reading or dismissing a steering message', () => {
  beforeEach(() => {
    worker.answers = []
    worker.calls = []
    mothershipAgentUrlMockFns.mockGetMothershipBaseURL.mockResolvedValue(WORKER)
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      worker.calls.push(String(input).replace(WORKER, ''))
      const next = worker.answers.shift()
      if (!next) throw new Error('No scripted worker answer')
      return next
    })
    mockChatContext.mockResolvedValue({
      chatId: 'chat-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: false,
    })
    workspaceAuthorizationMockFns.mockAuthorizeWorkspaceOperation.mockResolvedValue(undefined)
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-1' },
    })
    mockRecordDisposition.mockResolvedValue(undefined)
    runIs('active')
  })

  it('reads a message without sending it, and keeps a final answer', async () => {
    recorded()
    worker.answers.push(
      Response.json({ steeringId: STEERING_ID, status: 'applied', eventSeq: 3, textOffset: 2 })
    )

    const response = await read()

    expect(await response.json()).toEqual({
      steeringId: STEERING_ID,
      status: 'applied',
      eventSeq: 3,
      textOffset: 2,
    })
    expect(worker.calls).toEqual([READ])
    expect(mockRecordDisposition).toHaveBeenCalledWith('chat-1', [STEERING_ID], {
      status: 'applied',
      eventSeq: 3,
      textOffset: 2,
    })
  })

  it('holds a message a live run has not accepted yet, since its steer may be on its way', async () => {
    recorded()
    worker.answers.push(Response.json({ steeringId: STEERING_ID, status: 'unknown' }))

    const response = await read()

    expect(await response.json()).toEqual({ steeringId: STEERING_ID, status: 'queued' })
    expect(worker.calls).toEqual([READ])
    expect(mockRecordDisposition).not.toHaveBeenCalled()
  })

  it('reads a message a run ended without accepting as not delivered, for good', async () => {
    recorded()
    runIs('complete')
    worker.answers.push(Response.json({ steeringId: STEERING_ID, status: 'unknown' }))

    const response = await read()

    expect(await response.json()).toEqual({ steeringId: STEERING_ID, status: 'not_applied' })
    expect(mockRecordDisposition).toHaveBeenCalledWith('chat-1', [STEERING_ID], {
      status: 'not_applied',
    })
  })

  it('reads an id the chat holds no record of as not delivered, asking the worker nothing', async () => {
    const response = await read()

    expect(await response.json()).toEqual({ steeringId: STEERING_ID, status: 'not_applied' })
    expect(worker.calls).toEqual([])
  })

  it('answers from the record, asking the worker nothing, once the answer is final', async () => {
    recorded({ streamId: TURN_ID, disposition: { status: 'not_applied' } })

    const response = await read()

    expect(await response.json()).toEqual({ steeringId: STEERING_ID, status: 'not_applied' })
    expect(worker.calls).toEqual([])
  })

  it.each([
    ['a bare 404', withoutRead],
    ['a 405', () => new Response(null, { status: 405 })],
    ['a body outside the contract', () => Response.json({ settled: true })],
  ])(
    "decides from Sim's run when the worker answers %s, never re-sending",
    async (_name, reply) => {
      worker.answers.push(reply(), reply())

      recorded()
      const whileLive = await read()
      runIs('complete')
      recorded()
      const onceEnded = await read()

      expect(await whileLive.json()).toEqual({ steeringId: STEERING_ID, status: 'queued' })
      expect(await onceEnded.json()).toEqual({ steeringId: STEERING_ID, status: 'not_applied' })
      expect(worker.calls).toEqual([READ, READ])
    }
  )

  it('keeps a message a live run has not accepted yet, and never delivers it', async () => {
    recorded()
    worker.answers.push(Response.json({ steeringId: STEERING_ID, status: 'unknown' }))

    const response = await dismiss()

    expect(await response.json()).toEqual({ status: 'busy', streamId: TURN_ID })
    expect(worker.calls).toEqual([READ])
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })

  it('dismisses a message once its run ended without accepting it', async () => {
    recorded()
    runIs('complete')
    worker.answers.push(Response.json({ steeringId: STEERING_ID, status: 'unknown' }))

    const response = await dismiss()

    expect(await response.json()).toEqual({ status: 'dismissed' })
    expect(worker.calls).toEqual([READ])
    expect(dbChainMockFns.delete).toHaveBeenCalledWith(copilotMessages)
  })

  it('keeps a message a live run may hold when the worker predates the read', async () => {
    recorded()
    worker.answers.push(withoutRead())

    const response = await dismiss()

    expect(await response.json()).toEqual({ status: 'busy', streamId: TURN_ID })
    expect(worker.calls).toEqual([READ])
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })
})
