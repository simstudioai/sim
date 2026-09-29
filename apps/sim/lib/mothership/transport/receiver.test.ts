import {
  mothershipAgentUrlMock,
  mothershipAgentUrlMockFns,
} from '@sim/testing/mocks/mothership-agent-url.mock'
import {
  mothershipGoFetchMock,
  mothershipGoFetchMockFns,
} from '@sim/testing/mocks/mothership-go-fetch.mock'
import { utilsHelpersMock, utilsHelpersMockFns } from '@sim/testing/mocks/utils-helpers.mock'
import { setEnv } from '@sim/testing/mocks/env.mock'
import { setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import { generateId } from '@sim/utils/id'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }))
vi.mock('@/lib/mothership/request/go/fetch', () => mothershipGoFetchMock)
vi.mock('@/lib/mothership/request/headers', () => ({
  mothershipRequestHeaders: () => ({ 'x-api-key': 'worker-key' }),
}))
vi.mock('@/lib/mothership/transport/control', () => ({ executeSimControl: execute }))
vi.mock('@/lib/mothership/server/agent-url', () => mothershipAgentUrlMock)
vi.mock('@sim/utils/helpers', () => utilsHelpersMock)

import { receiveSimControls, startSimReceivers } from '@/lib/mothership/transport/receiver'

const mocks = {
  fetch: mothershipGoFetchMockFns.mockFetchGo,
  execute,
  sleep: utilsHelpersMockFns.mockSleep,
}

function request() {
  const chatId = generateId()
  return {
    id: generateId(),
    expiresAt: Date.now() + 5000,
    scope: { chatId, userId: 'user', workspaceId: generateId() },
    operation: { kind: 'run_control', input: { chatId, streamId: generateId() } },
  }
}

describe('outbound receiver lifecycle', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mothershipAgentUrlMockFns.mockGetMothershipBaseURL.mockResolvedValue('https://worker.test')
    mocks.sleep.mockResolvedValue(undefined)
    mocks.execute.mockResolvedValue({ status: 200, body: '{"stopped":false}' })
  })

  it('reconnects after a lost poll and correlates parallel replies by request ID', async () => {
    const controller = new AbortController()
    const first = request()
    const second = request()
    const replies: unknown[] = []
    let polls = 0
    mocks.fetch.mockImplementation(async (url: string, init: RequestInit) => {
      expect(url.startsWith('https://worker.test/api/sim-transport/')).toBe(true)
      expect(init.headers).toEqual({ 'x-api-key': 'worker-key' })
      expect(init.redirect).toBe('error')
      if (url.endsWith('/poll')) {
        polls++
        if (polls === 1) throw new Error('connection lost')
        if (polls === 2) return Response.json({ requests: [first, second] })
        controller.abort()
        throw new Error('shutdown')
      }
      replies.push(JSON.parse(String(init.body)))
      return Response.json({ accepted: true })
    })
    await receiveSimControls('https://worker.test', 'a'.repeat(64), controller.signal)
    expect(mocks.execute).toHaveBeenCalledTimes(2)
    expect(replies).toEqual(
      expect.arrayContaining([
        {
          channelId: 'a'.repeat(64),
          id: first.id,
          result: { status: 200, body: '{"stopped":false}' },
        },
        {
          channelId: 'a'.repeat(64),
          id: second.id,
          result: { status: 200, body: '{"stopped":false}' },
        },
      ])
    )
    expect(mocks.sleep).toHaveBeenCalledOnce()
  })

  it('does not execute malformed or redirected responses as Sim operations', async () => {
    const controller = new AbortController()
    mocks.fetch
      .mockResolvedValueOnce(new Response(null, { status: 302 }))
      .mockResolvedValueOnce(Response.json({ requests: [{ operation: { kind: 'unknown' } }] }))
      .mockImplementationOnce(async () => {
        controller.abort()
        throw new Error('shutdown')
      })
    await receiveSimControls('https://worker.test', 'a'.repeat(64), controller.signal)
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(mocks.sleep).toHaveBeenCalledTimes(2)
  })

  it('does not repeat an operation when its reply acknowledgement is lost', async () => {
    const controller = new AbortController()
    mocks.fetch
      .mockResolvedValueOnce(Response.json({ requests: [request()] }))
      .mockRejectedValueOnce(new Error('reply lost'))
      .mockImplementationOnce(async () => {
        controller.abort()
        throw new Error('shutdown')
      })
    await receiveSimControls('https://worker.test', 'a'.repeat(64), controller.signal)
    expect(mocks.execute).toHaveBeenCalledOnce()
  })

  it.each(['dev', 'dedicated'])(
    'services %s benchmark controls when ordinary hosted traffic uses direct callbacks',
    async (endpoint) => {
      setEnvFlags({ isHosted: true, isMothershipBenchmarkEnabled: true })
      setEnv({
        COPILOT_API_KEY: 'worker-key',
        COPILOT_DEV_URL: endpoint === 'dev' ? 'https://benchmark-worker.test/' : undefined,
        MOTHERSHIP_BENCHMARK_URL:
          endpoint === 'dedicated' ? 'https://dedicated-benchmark.test/' : undefined,
        MOTHERSHIP_SIM_TRANSPORT: 'direct',
      })
      const shutdown: (() => void)[] = []
      const listeners = vi.spyOn(process, 'once').mockImplementation((_event, listener) => {
        shutdown.push(() => listener())
        return process
      })
      const control = request()
      const reply = Promise.withResolvers<{ id: string; result: { body: string } }>()
      let polls = 0
      mocks.fetch.mockImplementation(async (url: string, init: RequestInit) => {
        if (url.endsWith('/poll')) {
          polls++
          if (polls === 1) return Response.json({ requests: [control] })
          return new Promise<Response>(() => {})
        }
        reply.resolve(JSON.parse(String(init.body)))
        return Response.json({ accepted: true })
      })
      try {
        await startSimReceivers()
        expect(polls).toBe(1)
        expect(await reply.promise).toMatchObject({
          id: control.id,
          result: { body: '{"stopped":false}' },
        })
      } finally {
        for (const stop of shutdown) stop()
        listeners.mockRestore()
      }
    }
  )
})
