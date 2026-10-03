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

type Answer = () => Promise<Response>

/** What undici throws for a refused or reset socket: a TypeError with the syscall code on `cause`. */
function socketFailure(code: string): TypeError {
  return new TypeError('fetch failed', { cause: Object.assign(new Error(code), { code }) })
}

/** A fake worker: it records every fork request it receives and answers from a script. */
let received: unknown[] = []
let script: Answer[] = []
const receipt: Answer = async () =>
  Response.json({ chatId: request.newChatId, sourceThroughSeq: 7 })

function answer(...answers: Answer[]) {
  script = answers
}

const status =
  (code: number, body: BodyInit | null = ''): Answer =>
  async () =>
    new Response(body, { status: code })

beforeEach(() => {
  mothershipAgentUrlMockFns.mockGetMothershipBaseURL.mockResolvedValue('http://worker.test')
  received = []
  script = []
  mothershipGoFetchMockFns.mockFetchGo.mockReset()
  mothershipGoFetchMockFns.mockFetchGo.mockImplementation(
    async (_url: string, init: { body: string }) => {
      received.push(JSON.parse(init.body))
      return (script.shift() ?? receipt)()
    }
  )
})

it.each(['EHOSTUNREACH', 'ENETUNREACH'])(
  'retries a fork the worker never received (%s)',
  async (code) => {
    answer(async () => {
      throw socketFailure(code)
    })
    await copyWorkerConversation(request)
    expect(received).toEqual([request, request])
  }
)

it.each(['lost-response', 'temporary-error'])(
  'retries the same immutable fork after %s',
  async (failure) => {
    answer(
      failure === 'lost-response'
        ? async () => {
            throw socketFailure('ECONNRESET')
          }
        : status(503)
    )
    await copyWorkerConversation(request)
    expect(received).toEqual([request, request])
  }
)

it.each(['missing-receipt', 'wrong-chat', 'unavailable'])(
  'refuses an unconfirmed copy: %s',
  async (failure) => {
    const reply: Answer = async () => {
      if (failure === 'unavailable') throw socketFailure('ECONNREFUSED')
      return Response.json(
        failure === 'wrong-chat' ? { chatId: generateId(), sourceThroughSeq: 7 } : { ok: true }
      )
    }
    answer(reply, reply)
    await expect(copyWorkerConversation(request)).rejects.toThrow()
    // Only the unreachable worker may never have seen the request; an answer is final.
    expect(received).toHaveLength(failure === 'unavailable' ? 2 : 1)
  }
)

it.each([
  [404, 'not_found'],
  [409, 'conflict'],
  [413, 'payload_too_large'],
] as const)('classifies a worker %i refusal as %s without retrying it', async (code, kind) => {
  answer(status(code, JSON.stringify({ error: 'refused' })), receipt)
  const failure = await copyWorkerConversation(request).catch((error: unknown) => error)
  expect(asOrchestrationError(failure)?.code).toBe(kind)
  expect(received).toHaveLength(1)
})

it('classifies a refusal whose body fails to cancel', async () => {
  const body = new ReadableStream({
    cancel() {
      throw new TypeError('Body already closed')
    },
  })
  answer(status(404, body), receipt)
  const failure = await copyWorkerConversation(request).catch((error: unknown) => error)
  expect(asOrchestrationError(failure)?.code).toBe('not_found')
  expect(received).toHaveLength(1)
})

it.each([500, 400])('does not repeat a fork the worker failed with %i', async (code) => {
  answer(status(code), receipt)
  const failure = await copyWorkerConversation(request).catch((error: unknown) => error)
  expect(failure).toBeInstanceOf(Error)
  expect(asOrchestrationError(failure)).toBeNull()
  expect(received).toHaveLength(1)
})

it.each([502, 504])('retries a %i gateway failure once', async (code) => {
  answer(status(code))
  await copyWorkerConversation(request)
  expect(received).toEqual([request, request])
})

it('does not start a second copy while a timed-out one may still be running', async () => {
  answer(async () => {
    throw new DOMException('The operation timed out.', 'TimeoutError')
  }, receipt)
  await expect(copyWorkerConversation(request)).rejects.toThrow()
  expect(received).toHaveLength(1)
})

it('does not repeat a fork after a TypeError that is not a socket failure', async () => {
  answer(async () => {
    throw new TypeError('Body is unusable: Body has already been read')
  }, receipt)
  await expect(copyWorkerConversation(request)).rejects.toThrow()
  expect(received).toHaveLength(1)
})
