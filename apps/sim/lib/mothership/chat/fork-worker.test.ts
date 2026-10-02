import {
  mothershipAgentUrlMock,
  mothershipAgentUrlMockFns,
} from '@sim/testing/mocks/mothership-agent-url.mock'
import {
  mothershipGoFetchMock,
  mothershipGoFetchMockFns,
} from '@sim/testing/mocks/mothership-go-fetch.mock'
import { generateId } from '@sim/utils/id'
import { beforeEach, expect, it, vi } from 'vitest'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { copyWorkerConversation } from '@/lib/mothership/chat/fork-worker'
import type { ForkChatRequest } from '@/lib/mothership/generated/protocol'

vi.mock('@/lib/mothership/request/go/fetch', () => mothershipGoFetchMock)
vi.mock('@/lib/mothership/server/agent-url', () => mothershipAgentUrlMock)

const fetchWorker = mothershipGoFetchMockFns.mockFetchGo

const request: ForkChatRequest = {
  sourceChatId: generateId(),
  newChatId: generateId(),
  workspaceId: generateId(),
  userId: 'fork-reader',
  upToMessageId: generateId(),
  includeResponse: true,
  fileIds: { wf_source: 'wf_fork' },
  fileKeys: {},
}

beforeEach(() => {
  mothershipAgentUrlMockFns.mockGetMothershipBaseURL.mockResolvedValue('http://worker.test')
  fetchWorker.mockReset()
  fetchWorker.mockImplementation(async () =>
    Response.json({ chatId: request.newChatId, sourceThroughSeq: 7 })
  )
})

it.each(['lost-response', 'temporary-error'])(
  'retries the same immutable fork after %s',
  async (failure) => {
    if (failure === 'lost-response')
      fetchWorker.mockRejectedValueOnce(new TypeError('Connection ended'))
    else fetchWorker.mockResolvedValueOnce(new Response('', { status: 503 }))
    await copyWorkerConversation(request)
    expect(fetchWorker).toHaveBeenCalledTimes(2)
    expect(fetchWorker.mock.calls[0][1].body).toBe(fetchWorker.mock.calls[1][1].body)
    expect(JSON.parse(fetchWorker.mock.calls[1][1].body)).toEqual(request)
  }
)

it.each(['missing-receipt', 'wrong-chat', 'unavailable'])(
  'refuses an unconfirmed copy: %s',
  async (failure) => {
    fetchWorker.mockImplementation(async () => {
      if (failure === 'unavailable') throw new TypeError('Worker unavailable')
      return Response.json(
        failure === 'wrong-chat' ? { chatId: generateId(), sourceThroughSeq: 7 } : { ok: true }
      )
    })
    await expect(copyWorkerConversation(request)).rejects.toThrow()
    // Only the unreachable worker may never have seen the request; an answer is final.
    expect(fetchWorker).toHaveBeenCalledTimes(failure === 'unavailable' ? 2 : 1)
  }
)

it.each([
  [404, 'not_found'],
  [409, 'conflict'],
  [413, 'payload_too_large'],
] as const)('classifies a worker %i refusal as %s without retrying it', async (status, code) => {
  fetchWorker.mockResolvedValue(Response.json({ error: 'refused' }, { status }))
  const failure = await copyWorkerConversation(request).catch((error: unknown) => error)
  expect(asOrchestrationError(failure)?.code).toBe(code)
  expect(fetchWorker).toHaveBeenCalledTimes(1)
})

it.each([500, 400])('does not repeat a fork the worker failed with %i', async (status) => {
  fetchWorker.mockResolvedValue(new Response('', { status }))
  const failure = await copyWorkerConversation(request).catch((error: unknown) => error)
  expect(asOrchestrationError(failure)).toBeNull()
  expect(fetchWorker).toHaveBeenCalledTimes(1)
})

it.each([502, 504])('retries a %i gateway failure once', async (status) => {
  fetchWorker.mockResolvedValueOnce(new Response('', { status }))
  await copyWorkerConversation(request)
  expect(fetchWorker).toHaveBeenCalledTimes(2)
})

it('does not start a second copy while a timed-out one may still be running', async () => {
  fetchWorker.mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'))
  await expect(copyWorkerConversation(request)).rejects.toThrow()
  expect(fetchWorker).toHaveBeenCalledTimes(1)
})
