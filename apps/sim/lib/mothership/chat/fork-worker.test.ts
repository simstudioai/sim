/** @vitest-environment node */
import { generateId } from '@sim/utils/id'
import { beforeEach, expect, it, vi } from 'vitest'
import { copyWorkerConversation } from '@/lib/mothership/chat/fork-worker'
import type { ForkChatRequest } from '@/lib/mothership/generated/protocol'

const { fetchWorker } = vi.hoisted(() => ({ fetchWorker: vi.fn() }))
vi.mock('@/lib/mothership/request/go/fetch', () => ({ fetchGo: fetchWorker }))
vi.mock('@/lib/mothership/server/agent-url', () => ({
  getMothershipBaseURL: async () => 'http://worker.test',
  getMothershipSourceEnvHeaders: () => ({}),
}))

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
    expect(fetchWorker).toHaveBeenCalledTimes(2)
  }
)
